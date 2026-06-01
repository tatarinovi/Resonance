import logging
from datetime import datetime, timedelta
from html import escape

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .aggregation import group_key_for_ticket
from .correlation_context import get_correlation_id
from .config import get_settings
from .directions import direction_alias_values, normalize_direction
from .expert_utils import domain_expert_conditions
from .mention_util import parse_mentioned_usernames
from .domain_events.catalog import DeliveryIntent, notification_delivery_defaults
from .models import Epic, NotificationType, Project, Ticket, TicketMessageKind, TicketStatus, User, UserRole
from .access_policy import is_coordinator_role
from .question_ticket_routing import QUESTION_ENG_DIRECTIONS
from .ticket_assignee import _first_project_user_by_direction
from .notification_helpers import create_notification
from .notification_routing import enqueue_broadcast_matrix_room, enqueue_personal_delivery
from .reference_data import QUESTION_STATUS_LABELS
from .resonance_paths import question_absolute_url, question_public_path
from .ticket_subscribers import ensure_ticket_subscriber, list_subscriber_user_ids


logger = logging.getLogger(__name__)


def _clip(text: str | None, limit: int = 180) -> str:
    value = (text or "").strip()
    if not value:
        return "—"
    return value if len(value) <= limit else f"{value[:limit].rstrip()}…"


def _target_url(ticket_id: int, reply: bool = False) -> str:
    """Stored on Notification.target_url — must be a client path (React Router), not `#/…`."""
    return question_public_path(ticket_id, reply=reply)


def _resolve_ticket_author(db: Session, ticket: Ticket) -> User | None:
    if ticket.author_id:
        user = db.get(User, ticket.author_id)
        if user:
            return user
    author_raw = (ticket.data_json or {}).get("author", "")
    if not author_raw:
        return None
    author_name = str(author_raw).replace("@", "").split(":")[0]
    if not author_name:
        return None
    return db.scalar(select(User).where(User.username == author_name))


def _author_matrix_mxid(ticket: Ticket, author: User | None) -> str | None:
    raw = (ticket.data_json or {}).get("author", "")
    if raw and str(raw).startswith("@"):
        return str(raw)
    if author and author.matrix_id and str(author.matrix_id).strip():
        return author.matrix_id
    return None


# Status changes that already send a dedicated notification to the ticket author.
_AUTHOR_PRIMARY_STATUS_CHANGES = frozenset({"answered", "returned"})


class NotificationService:
    def _web(
        self,
        db: Session,
        user: User | None,
        *,
        type: NotificationType,
        title: str,
        body: str,
        ticket_id: int,
        dedupe: str,
        reply: bool = False,
        project_id: int | None = None,
        operation_context_id: int | None = None,
    ):
        if not user:
            return None
        pid = project_id
        if pid is None:
            t = db.get(Ticket, ticket_id)
            pid = t.project_id if t else None
        gid = group_key_for_ticket(ticket_id)
        return create_notification(
            db,
            recipient_id=user.id,
            type=type.value,
            title=title,
            body=body,
            target_type="ticket",
            target_id=ticket_id,
            target_url=_target_url(ticket_id, reply=reply),
            dedupe_key=dedupe,
            operation_context_id=operation_context_id,
            project_id=pid,
            group_key=gid,
        )

    def _new_ticket_message(self, project_name: str, author: str, content: str, ticket_id: int, frontend_url: str) -> str:
        return (
            "📥 <b>Новый вопрос на проверку</b>\n"
            f"\nПроект: <b>{project_name}</b>"
            f"\nАвтор: {author or '—'}"
            f"\n\nСуть вопроса:"
            f"\n{_clip(content, 220)}"
            f"\n\n🔗 <a href='{question_absolute_url(frontend_url, ticket_id)}'>Открыть в Resonance</a>"
        )

    def _pending_approval_room_message(
        self,
        project_name: str,
        direction: str | None,
        lead: User | None,
        content: str,
        ticket_id: int,
        frontend_url: str,
    ) -> str:
        lead_label = "лид направления"
        if lead:
            mxid = (lead.matrix_id or "").strip()
            lead_label = (
                f'<a href="https://matrix.to/#/{escape(mxid, quote=True)}">{escape(mxid)}</a>'
                if mxid
                else escape(lead.username)
            )
        return (
            "🔎 <b>Новый вопрос на проверке</b>\n"
            f"\nПроект: <b>{escape(project_name)}</b>"
            f"\nНаправление: <b>{escape(direction or '—')}</b>"
            f"\nОтветственный: {lead_label}"
            f"\n\nСуть вопроса:"
            f"\n{escape(_clip(content, 220))}"
            f"\n\n🔗 <a href='{question_absolute_url(frontend_url, ticket_id)}'>Открыть в Resonance</a>"
        )

    def _forwarded_message(self, project_name: str, epic_name: str | None, content: str, ticket_id: int, frontend_url: str) -> str:
        return (
            "🚀 <b>Вам передан новый вопрос</b>\n"
            f"\nПроект: <b>{project_name}</b>"
            f"\nЭпик: {epic_name or '—'}"
            f"\n\nСодержание:"
            f"\n{_clip(content, 220)}"
            f"\n\n🔗 <a href='{question_absolute_url(frontend_url, ticket_id)}'>Открыть вопрос</a>"
        )

    def _answered_message(self, content: str, response_text: str, ticket_id: int, frontend_url: str) -> str:
        return (
            "✅ <b>На ваш вопрос получен ответ</b>\n"
            f"\nВопрос:"
            f"\n{_clip(content, 140)}"
            f"\n\nОтвет:"
            f"\n{_clip(response_text, 220)}"
            f"\n\n🔗 <a href='{question_absolute_url(frontend_url, ticket_id)}'>Посмотреть полностью</a>"
        )

    def _answered_room_message(
        self,
        project_name: str,
        title: str,
        author: User | None,
        response_text: str,
        ticket_id: int,
        frontend_url: str,
    ) -> str:
        author_label = "автор вопроса"
        if author:
            mxid = (author.matrix_id or "").strip()
            author_label = (
                f'<a href="https://matrix.to/#/{escape(mxid, quote=True)}">{escape(mxid)}</a>'
                if mxid
                else escape(author.username)
            )
        return (
            "✅ <b>Появился ответ на вопрос</b>\n"
            f"\nПроект: <b>{escape(project_name)}</b>"
            f"\nВопрос: <b>{escape(_clip(title, 160))}</b>"
            f"\nАвтор: {author_label}"
            f"\n\nОтвет:"
            f"\n{escape(_clip(response_text, 220))}"
            f"\n\n🔗 <a href='{question_absolute_url(frontend_url, ticket_id)}'>Открыть вопрос</a>"
        )

    def _returned_message(self, content: str, reason: str, ticket_id: int, frontend_url: str) -> str:
        return (
            "⚠️ <b>Вопрос возвращён на уточнение</b>\n"
            f"\nПо вопросу:"
            f"\n{_clip(content, 140)}"
            f"\n\nКомментарий:"
            f"\n{_clip(reason, 220)}"
            f"\n\n🔗 <a href='{question_absolute_url(frontend_url, ticket_id)}'>Уточнить детали</a>"
        )

    def _returned_room_message(
        self,
        project_name: str,
        title: str,
        author: User | None,
        reason: str,
        ticket_id: int,
        frontend_url: str,
    ) -> str:
        author_label = "автор вопроса"
        if author:
            mxid = (author.matrix_id or "").strip()
            author_label = (
                f'<a href="https://matrix.to/#/{escape(mxid, quote=True)}">{escape(mxid)}</a>'
                if mxid
                else escape(author.username)
            )
        return (
            "⚠️ <b>Вопрос возвращён на уточнение</b>\n"
            f"\nПроект: <b>{escape(project_name)}</b>"
            f"\nВопрос: <b>{escape(_clip(title, 160))}</b>"
            f"\nАвтор: {author_label}"
            f"\n\nКомментарий:"
            f"\n{escape(_clip(reason, 220))}"
            f"\n\n🔗 <a href='{question_absolute_url(frontend_url, ticket_id)}'>Открыть вопрос</a>"
        )

    def _sla_stagnation_message(
        self,
        project_name: str,
        title: str,
        status_label: str,
        hours_stale: int,
        ticket_id: int,
        frontend_url: str,
    ) -> str:
        return (
            "⏱ <b>Вопрос долго без движения</b>\n"
            f"\nПроект: <b>{project_name}</b>"
            f"\nСтатус: <b>{status_label}</b>"
            f"\nБез обновлений: <b>~{hours_stale} ч</b> (более 2 суток)"
            f"\n\nВопрос:"
            f"\n{_clip(title, 220)}"
            f"\n\n🔗 <a href='{question_absolute_url(frontend_url, ticket_id)}'>Открыть в Resonance</a>"
        )

    def _expert_room_awareness_message(
        self,
        project_name: str,
        direction: str | None,
        title: str,
        assignee: User | None,
        ticket_id: int,
        frontend_url: str,
    ) -> str:
        dir_label = direction or "—"
        assignee_label = "—"
        if assignee:
            mxid = (assignee.matrix_id or "").strip()
            assignee_label = (
                f'<a href="https://matrix.to/#/{escape(mxid, quote=True)}">{escape(mxid)}</a>'
                if mxid
                else escape(assignee.username)
            )
        return (
            "🔔 <b>Новый вопрос у эксперта</b>\n"
            f"\nПроект: <b>{escape(project_name)}</b>"
            f"\nНаправление: <b>{escape(dir_label)}</b>"
            f"\nВопрос: <b>{escape(_clip(title, 160))}</b>"
            f"\nОтветственный: {assignee_label}"
            f"\n\n🔗 <a href='{question_absolute_url(frontend_url, ticket_id)}'>Открыть карточку</a>"
        )

    def _ticket_mention_message(
        self,
        project_name: str,
        author_username: str,
        snippet: str,
        ticket_id: int,
        frontend_url: str,
    ) -> str:
        return (
            "👤 <b>Вас упомянули в обсуждении вопроса</b>\n"
            f"\nПроект: <b>{project_name}</b>"
            f"\nОт: {author_username or '—'}"
            f"\n\nФрагмент:"
            f"\n{_clip(snippet, 220)}"
            f"\n\n🔗 <a href='{question_absolute_url(frontend_url, ticket_id, reply=True)}'>Открыть обсуждение</a>"
        )

    async def _enqueue_transport(
        self,
        db: Session,
        user: User | None,
        message: str,
        *,
        notification_type: str,
        severity: str,
        notification_id: int | None,
        operation_context_id: int | None,
        matrix_override_mxid: str | None = None,
        debounce_matrix: bool | None = None,
    ) -> None:
        if not user:
            return
        cid = get_correlation_id()
        suffix = str(notification_id or "na")
        enqueue_personal_delivery(
            db,
            user=user,
            notification_type=notification_type,
            notification_id=notification_id,
            severity=severity,
            html=message,
            matrix_override_mxid=matrix_override_mxid,
            operation_context_id=operation_context_id,
            correlation_id=cid,
            idempotency_suffix=suffix,
            debounce_matrix_override=debounce_matrix,
        )

    async def notify_ticket_mentions(
        self,
        db: Session,
        *,
        ticket_id: int,
        message_id: int,
        author_id: int | None,
        author_username: str,
        body: str,
        operation_context_id: int | None = None,
    ) -> None:
        names = parse_mentioned_usernames(body)
        if not names:
            return

        ticket = db.scalar(
            select(Ticket)
            .options(selectinload(Ticket.project).selectinload(Project.users))
            .where(Ticket.id == ticket_id)
        )
        if not ticket or not ticket.project:
            return

        project = ticket.project
        member_ids = {u.id for u in project.users}
        settings = get_settings()
        notified: set[int] = set()

        for raw in names:
            mentioned = db.scalar(select(User).where(func.lower(User.username) == raw.lower()))
            if not mentioned or not mentioned.is_approved:
                continue
            if mentioned.id not in member_ids:
                continue
            if author_id is not None and mentioned.id == author_id:
                continue
            if mentioned.id in notified:
                continue
            notified.add(mentioned.id)
            ensure_ticket_subscriber(db, ticket.id, mentioned.id)

            message = self._ticket_mention_message(
                project.name,
                author_username,
                body,
                ticket.id,
                settings.frontend_url,
            )
            created = self._web(
                db,
                mentioned,
                type=NotificationType.TICKET_MENTIONED,
                title="Вас упомянули в вопросе",
                body=f"{author_username}: {_clip(body, 160)}",
                ticket_id=ticket.id,
                dedupe=f"ticket:{ticket.id}:mention:{message_id}:{mentioned.id}",
                reply=True,
                project_id=project.id,
                operation_context_id=operation_context_id,
            )
            if created:
                await self._enqueue_transport(
                    db,
                    mentioned,
                    message,
                    notification_type=NotificationType.TICKET_MENTIONED.value,
                    severity=created.severity,
                    notification_id=created.id,
                    operation_context_id=operation_context_id,
                )

    def _project_lead_users(self, db: Session, project: Project) -> list[User]:
        stmt = (
            select(User)
            .join(User.projects)
            .where(Project.id == project.id)
        )
        return [u for u in db.scalars(stmt).all() if u.role == UserRole.ADMIN or is_coordinator_role(u)]

    async def notify_ticket_stagnation_sla_warning(
        self, db: Session, ticket_id: int, operation_context_id: int | None = None
    ) -> None:
        threshold = datetime.utcnow() - timedelta(days=2)
        ticket = db.get(Ticket, ticket_id)
        if not ticket:
            return
        if ticket.status not in (
            TicketStatus.PENDING_APPROVAL,
            TicketStatus.FORWARDED,
            TicketStatus.RETURNED,
        ):
            return
        if ticket.updated_at > threshold:
            return

        project = db.get(Project, ticket.project_id)
        if not project:
            return

        leads = self._project_lead_users(db, project)
        recipients: dict[int, User] = {u.id: u for u in leads}
        if ticket.assignee_id:
            assignee = db.get(User, ticket.assignee_id)
            if assignee and assignee.is_approved:
                recipients.setdefault(assignee.id, assignee)

        if not recipients:
            return

        settings = get_settings()
        stale_hours = max(48, int((datetime.utcnow() - ticket.updated_at).total_seconds() // 3600))
        status_labels = {
            TicketStatus.PENDING_APPROVAL.value: "На проверке",
            TicketStatus.FORWARDED.value: "У эксперта",
            TicketStatus.RETURNED.value: "На уточнении",
        }
        status_label = QUESTION_STATUS_LABELS.get(ticket.status.value, status_labels.get(ticket.status.value, ticket.status.value))
        title_snippet = (ticket.title or "").strip() or (ticket.description or "").strip() or ticket.data_json.get("content", "") or "—"
        matrix_message = self._sla_stagnation_message(
            project.name,
            title_snippet,
            status_label,
            stale_hours,
            ticket.id,
            settings.frontend_url,
        )
        stale_ts = int(ticket.updated_at.timestamp())
        dedupe_base = f"ticket:{ticket.id}:sla_stagnation:{stale_ts}"
        body_short = f"{project.name}, {status_label}: без обновлений более 2 суток — {_clip(title_snippet, 100)}"

        for user in recipients.values():
            created = self._web(
                db,
                user,
                type=NotificationType.TICKET_SLA_STAGNATION,
                title="Вопрос долго без движения",
                body=body_short,
                ticket_id=ticket.id,
                dedupe=f"{dedupe_base}:u{user.id}",
                project_id=project.id,
                operation_context_id=operation_context_id,
            )
            if created is None:
                continue
            await self._enqueue_transport(
                db,
                user,
                matrix_message,
                notification_type=NotificationType.TICKET_SLA_STAGNATION.value,
                severity=created.severity,
                notification_id=created.id,
                operation_context_id=operation_context_id,
                debounce_matrix=False,
            )

    async def notify_new_ticket(self, db: Session, ticket: Ticket, operation_context_id: int | None = None) -> None:
        project = db.get(Project, ticket.project_id)
        if not project:
            return

        leads = self._project_lead_users(db, project)

        settings = get_settings()
        content = ticket.data_json.get("content", "")
        direction = normalize_direction(ticket.data_json.get("validation_team") or ticket.data_json.get("target_direction"))
        message = self._new_ticket_message(
            project_name=project.name,
            author=ticket.data_json.get("author", "unknown"),
            content=content,
            ticket_id=ticket.id,
            frontend_url=settings.frontend_url,
        )
        assigned_lead = db.get(User, ticket.assignee_id) if ticket.assignee_id else None
        if (
            isinstance(direction, str)
            and project.config_json.get("notify_new_questions_to_expert_rooms")
        ):
            room_map = project.config_json.get("expert_rooms", {})
            room_id = None
            if isinstance(room_map, dict):
                for key in direction_alias_values(direction):
                    room_id = room_map.get(key)
                    if room_id:
                        break
            if room_id:
                enqueue_broadcast_matrix_room(
                    db,
                    room_id=room_id,
                    html=self._pending_approval_room_message(
                        project.name,
                        direction,
                        assigned_lead,
                        content,
                        ticket.id,
                        settings.frontend_url,
                    ),
                    notification_id=None,
                    project_id=project.id,
                    operation_context_id=operation_context_id,
                    correlation_id=get_correlation_id(),
                    idempotency_suffix=f"ticket:{ticket.id}:pending_room:{room_id}",
                    broadcast_intent_value=DeliveryIntent.TEAM_AWARENESS.value,
                    routing_reason="broadcast_team_awareness_pending_approval",
                )

        for lead in leads:
            created = self._web(
                db,
                lead,
                type=NotificationType.TICKET_CREATED,
                title="Новый вопрос на валидацию",
                body=f"{project.name}: {_clip(content, 120)}",
                ticket_id=ticket.id,
                dedupe=f"ticket:{ticket.id}:created:{lead.id}",
                project_id=project.id,
                operation_context_id=operation_context_id,
            )
            if not created:
                continue
            await self._enqueue_transport(
                db,
                lead,
                message,
                notification_type=NotificationType.TICKET_CREATED.value,
                severity=created.severity,
                notification_id=created.id,
                operation_context_id=operation_context_id,
            )

    async def notify_expert_forwarded(self, db: Session, ticket: Ticket, operation_context_id: int | None = None) -> None:
        project = db.get(Project, ticket.project_id)
        if not project:
            return

        epic_name = ticket.data_json.get("epic_name")
        direction = normalize_direction(ticket.data_json.get("target_direction"))
        target_expert_id = None

        settings = get_settings()
        content = ticket.data_json.get("content", "")
        title = (ticket.title or "").strip() or ticket.data_json.get("title") or _clip(content, 80)
        message = self._forwarded_message(project.name, epic_name, content, ticket.id, settings.frontend_url)

        if isinstance(direction, str) and direction in QUESTION_ENG_DIRECTIONS:
            lead_id = _first_project_user_by_direction(db, project.id, direction)
            if lead_id:
                lead = db.get(User, lead_id)
                if lead:
                    created = self._web(
                        db,
                        lead,
                        type=NotificationType.TICKET_FORWARDED,
                        title="Вам передан вопрос",
                        body=f"{epic_name or project.name}: {_clip(content, 120)}",
                        ticket_id=ticket.id,
                        dedupe=f"ticket:{ticket.id}:forwarded:{lead.id}",
                        reply=True,
                        project_id=project.id,
                        operation_context_id=operation_context_id,
                    )
                    if created:
                        await self._enqueue_transport(
                            db,
                            lead,
                            message,
                            notification_type=NotificationType.TICKET_FORWARDED.value,
                            severity=created.severity,
                            notification_id=created.id,
                            operation_context_id=operation_context_id,
                        )
                    return

        epic = db.get(Epic, ticket.epic_id) if ticket.epic_id else None
        if epic is None and epic_name:
            epic = db.scalar(select(Epic).where(Epic.project_id == project.id, Epic.title == epic_name))
        if epic:
            if direction == "analytics":
                target_expert_id = epic.lead_analyst_id
            elif direction == "design":
                target_expert_id = epic.lead_designer_id
        if ticket.assignee_id:
            target_expert_id = target_expert_id or ticket.assignee_id

        cid = get_correlation_id()
        fwd_defaults = notification_delivery_defaults(NotificationType.TICKET_FORWARDED.value)

        if (
            project.config_json.get("notify_new_questions_to_expert_rooms")
            and fwd_defaults.allow_broadcast_companion
        ):
            room_map = project.config_json.get("expert_rooms", {})
            expert_room_id = None
            if isinstance(room_map, dict):
                for key in direction_alias_values(direction):
                    expert_room_id = room_map.get(key)
                    if expert_room_id:
                        break
            if expert_room_id:
                assigned_expert = db.get(User, target_expert_id) if target_expert_id else None
                awareness = self._expert_room_awareness_message(
                    project.name, direction, title, assigned_expert, ticket.id, settings.frontend_url
                )
                enqueue_broadcast_matrix_room(
                    db,
                    room_id=expert_room_id,
                    html=awareness,
                    notification_id=None,
                    project_id=project.id,
                    operation_context_id=operation_context_id,
                    correlation_id=cid,
                    idempotency_suffix=f"ticket:{ticket.id}:expert_room:{expert_room_id}",
                    broadcast_intent_value=DeliveryIntent.TEAM_AWARENESS.value,
                    routing_reason="broadcast_team_awareness_expert_room",
                )

        if target_expert_id:
            expert = db.get(User, target_expert_id)
            if expert:
                created = self._web(
                    db,
                    expert,
                    type=NotificationType.TICKET_FORWARDED,
                    title="Вам передан вопрос",
                    body=f"{epic_name or project.name}: {_clip(content, 120)}",
                    ticket_id=ticket.id,
                    dedupe=f"ticket:{ticket.id}:forwarded:{expert.id}",
                    reply=True,
                    project_id=project.id,
                    operation_context_id=operation_context_id,
                )
                if created:
                    await self._enqueue_transport(
                        db,
                        expert,
                        message,
                        notification_type=NotificationType.TICKET_FORWARDED.value,
                        severity=created.severity,
                        notification_id=created.id,
                        operation_context_id=operation_context_id,
                    )
                return

        stmt = select(User).where(domain_expert_conditions())
        if direction:
            stmt = stmt.where(User.direction == direction)

        experts = db.scalars(stmt).all()
        for expert in experts:
            if project.id in [p.id for p in expert.projects]:
                created = self._web(
                    db,
                    expert,
                    type=NotificationType.TICKET_FORWARDED,
                    title="Вам передан вопрос",
                    body=f"{epic_name or project.name}: {_clip(content, 120)}",
                    ticket_id=ticket.id,
                    dedupe=f"ticket:{ticket.id}:forwarded:{expert.id}",
                    reply=True,
                    project_id=project.id,
                    operation_context_id=operation_context_id,
                )
                if created:
                    await self._enqueue_transport(
                        db,
                        expert,
                        message,
                        notification_type=NotificationType.TICKET_FORWARDED.value,
                        severity=created.severity,
                        notification_id=created.id,
                        operation_context_id=operation_context_id,
                    )

    async def notify_author_answered(
        self, db: Session, ticket: Ticket, response_text: str, operation_context_id: int | None = None
    ) -> None:
        author = _resolve_ticket_author(db, ticket)
        project = db.get(Project, ticket.project_id)

        settings = get_settings()
        message = self._answered_message(ticket.data_json.get("content", ""), response_text, ticket.id, settings.frontend_url)
        created = self._web(
            db,
            author,
            type=NotificationType.TICKET_ANSWERED,
            title="На ваш вопрос ответили",
            body=_clip(response_text or ticket.data_json.get("response", ""), 160),
            ticket_id=ticket.id,
            dedupe=f"ticket:{ticket.id}:answered",
            project_id=ticket.project_id,
            operation_context_id=operation_context_id,
        )
        if created:
            await self._enqueue_transport(
                db,
                author,
                message,
                notification_type=NotificationType.TICKET_ANSWERED.value,
                severity=created.severity,
                notification_id=created.id,
                operation_context_id=operation_context_id,
                matrix_override_mxid=_author_matrix_mxid(ticket, author),
            )
        if project and project.config_json.get("notify_new_questions_to_expert_rooms"):
            direction = normalize_direction(
                ticket.data_json.get("validation_team")
                or ticket.data_json.get("source_direction")
                or (author.direction if author else None)
            )
            room_map = project.config_json.get("expert_rooms", {})
            room_id = None
            if isinstance(room_map, dict):
                for key in direction_alias_values(direction):
                    room_id = room_map.get(key)
                    if room_id:
                        break
            if room_id:
                title = (ticket.title or "").strip() or ticket.data_json.get("title") or ticket.data_json.get("content", "")
                enqueue_broadcast_matrix_room(
                    db,
                    room_id=room_id,
                    html=self._answered_room_message(
                        project.name,
                        title,
                        author,
                        response_text,
                        ticket.id,
                        settings.frontend_url,
                    ),
                    notification_id=None,
                    project_id=project.id,
                    operation_context_id=operation_context_id,
                    correlation_id=get_correlation_id(),
                    idempotency_suffix=f"ticket:{ticket.id}:answered_room:{room_id}",
                    broadcast_intent_value=DeliveryIntent.TEAM_AWARENESS.value,
                    routing_reason="broadcast_team_awareness_answered",
                )

    async def notify_author_returned(
        self, db: Session, ticket: Ticket, reason: str, operation_context_id: int | None = None
    ) -> None:
        author = _resolve_ticket_author(db, ticket)
        project = db.get(Project, ticket.project_id)

        settings = get_settings()
        message = self._returned_message(ticket.data_json.get("content", ""), reason, ticket.id, settings.frontend_url)
        created = self._web(
            db,
            author,
            type=NotificationType.TICKET_RETURNED,
            title="Вопрос вернули на уточнение",
            body=_clip(reason, 160),
            ticket_id=ticket.id,
            dedupe=f"ticket:{ticket.id}:returned",
            project_id=ticket.project_id,
            operation_context_id=operation_context_id,
        )
        if created:
            await self._enqueue_transport(
                db,
                author,
                message,
                notification_type=NotificationType.TICKET_RETURNED.value,
                severity=created.severity,
                notification_id=created.id,
                operation_context_id=operation_context_id,
                matrix_override_mxid=_author_matrix_mxid(ticket, author),
            )
        if project and project.config_json.get("notify_new_questions_to_expert_rooms"):
            direction = normalize_direction(
                ticket.data_json.get("validation_team")
                or ticket.data_json.get("source_direction")
                or (author.direction if author else None)
            )
            room_map = project.config_json.get("expert_rooms", {})
            room_id = None
            if isinstance(room_map, dict):
                for key in direction_alias_values(direction):
                    room_id = room_map.get(key)
                    if room_id:
                        break
            if room_id:
                title = (ticket.title or "").strip() or ticket.data_json.get("title") or ticket.data_json.get("content", "")
                enqueue_broadcast_matrix_room(
                    db,
                    room_id=room_id,
                    html=self._returned_room_message(
                        project.name,
                        title,
                        author,
                        reason,
                        ticket.id,
                        settings.frontend_url,
                    ),
                    notification_id=None,
                    project_id=project.id,
                    operation_context_id=operation_context_id,
                    correlation_id=get_correlation_id(),
                    idempotency_suffix=f"ticket:{ticket.id}:returned_room:{room_id}",
                    broadcast_intent_value=DeliveryIntent.TEAM_AWARENESS.value,
                    routing_reason="broadcast_team_awareness_returned",
                )

    def notify_ticket_watchers_message(
        self,
        db: Session,
        *,
        ticket_id: int,
        message_id: int,
        author_id: int | None,
        author_username: str,
        body: str,
        message_kind: str = TicketMessageKind.MESSAGE.value,
        operation_context_id: int | None = None,
    ) -> None:
        ticket = db.get(Ticket, ticket_id)
        skip_author_watch = (
            message_kind == TicketMessageKind.RESPONSE.value
            and ticket is not None
            and ticket.author_id is not None
        )
        for uid in list_subscriber_user_ids(db, ticket_id):
            if author_id is not None and uid == author_id:
                continue
            if skip_author_watch and uid == ticket.author_id:
                continue
            recipient = db.get(User, uid)
            self._web(
                db,
                recipient,
                type=NotificationType.TICKET_WATCH_MESSAGE,
                title="Новое сообщение в вопросе",
                body=f"{author_username}: {_clip(body, 140)}",
                ticket_id=ticket_id,
                dedupe=f"ticket:{ticket_id}:watch:msg:{message_id}:{uid}",
                reply=True,
                operation_context_id=operation_context_id,
            )

    def notify_ticket_watchers_status(
        self,
        db: Session,
        *,
        ticket_id: int,
        actor_id: int | None,
        old_status: str,
        new_status: str,
        operation_context_id: int | None = None,
    ) -> None:
        labels = {
            "pending_approval": "На проверке",
            "forwarded": "У эксперта",
            "returned": "На уточнении",
            "answered": "Ожидает автора",
            "closed": "Закрыт",
            "cancelled": "Отменён",
        }
        body = f"{labels.get(old_status, old_status)} → {labels.get(new_status, new_status)}"
        ticket = db.get(Ticket, ticket_id)
        skip_author_watch = False
        if ticket and ticket.author_id is not None:
            if new_status in _AUTHOR_PRIMARY_STATUS_CHANGES:
                skip_author_watch = True
            elif new_status == TicketStatus.PENDING_APPROVAL.value and old_status in (
                TicketStatus.CLOSED.value,
                TicketStatus.CANCELLED.value,
            ):
                skip_author_watch = True
        for uid in list_subscriber_user_ids(db, ticket_id):
            if actor_id is not None and uid == actor_id:
                continue
            if skip_author_watch and uid == ticket.author_id:
                continue
            recipient = db.get(User, uid)
            self._web(
                db,
                recipient,
                type=NotificationType.TICKET_WATCH_STATUS,
                title="Статус вопроса изменён",
                body=body,
                ticket_id=ticket_id,
                dedupe=f"ticket:{ticket_id}:watch:st:{new_status}:u{uid}:a{actor_id or 0}",
                reply=False,
                operation_context_id=operation_context_id,
            )


notification_service = NotificationService()
