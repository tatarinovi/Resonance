import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import and_, func, select

from .config import get_settings
from .database import SessionLocal
from .escalation_service import run_escalation_pass
from .matrix_service import matrix_bot
from .models import DigestRun, Epic, Project, Ticket, TicketEvent, TicketEventKind, TicketStatus, User
from .notification_outbound import process_pending_outbound_jobs
from .notification_service import notification_service
from .reference_data import DIGEST_STATUS_ORDER, QUESTION_STATUS_LABELS
from .retention_service import purge_old_delivery_attempts, purge_old_domain_event_logs
from .routers.analytics import refresh_kanban_analytics_snapshot_from_scheduler


logger = logging.getLogger(__name__)
_SCHEDULER_TZ = ZoneInfo("Europe/Moscow")


def _matrix_link(matrix_id: str) -> str:
    return f'<a href="https://matrix.to/#/{matrix_id}">{matrix_id}</a>'


STATUS_LABELS = {
    TicketStatus.PENDING_APPROVAL: "На проверке",
    TicketStatus.FORWARDED: "У эксперта",
    TicketStatus.RETURNED: "На уточнении",
    TicketStatus.ANSWERED: "Ожидает автора",
    TicketStatus.CLOSED: "Закрыт",
    TicketStatus.CANCELLED: "Отменён",
}


def _status_count_lines(status_counts: dict[TicketStatus, int]) -> str:
    status_labels = {TicketStatus(status): label for status, label in QUESTION_STATUS_LABELS.items()}
    ordered = tuple(TicketStatus(status) for status in DIGEST_STATUS_ORDER)
    return "\n".join(
        f"{status_labels[status]}: <b>{status_counts.get(status, 0)}</b>"
        for status in ordered
    )


def _moscow_day_start_as_utc_naive(now: datetime | None = None) -> datetime:
    now_moscow = now.astimezone(_SCHEDULER_TZ) if now and now.tzinfo else datetime.now(_SCHEDULER_TZ)
    start_moscow = now_moscow.replace(hour=0, minute=0, second=0, microsecond=0)
    return start_moscow.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)


def _main_project_room(config: dict[str, Any]) -> str:
    room_id = config.get("main_project_room")
    return room_id.strip() if isinstance(room_id, str) else ""


def _morning_digest_message(project_name: str, count: int, tags_str: str, project_id: int, frontend_url: str) -> str:
    base = (frontend_url or "").rstrip("/")
    return (
        "🌞 <b>Доброе утро</b>\n"
        f"\nПроект: <b>{project_name}</b>"
        f"\nОжидают ответа эксперта: <b>{count}</b>"
        f"\nСтатус: <b>У эксперта</b>"
        f"\n\nОтветственные:"
        f"\n{tags_str}"
        f"\n\n🔗 <a href='{base}/questions?status=forwarded&project={project_id}'>Открыть список</a>"
    )


def _evening_digest_message(project_name: str, asked_today: int, answered_today: int, open_total: int, status_counts: dict[TicketStatus, int], frontend_url: str) -> str:
    return (
        "🌙 <b>Итоги дня</b>\n"
        f"\nПроект: <b>{project_name}</b>"
        f"\n\nЗадано за день: <b>{asked_today}</b>"
        f"\nОтвечено за день: <b>{answered_today}</b>"
        f"\nВ этих статусах сейчас: <b>{open_total}</b>"
        f"\n\n<b>По статусам</b>"
        f"\n{_status_count_lines(status_counts)}"
        f"\n\n🔗 <a href='{frontend_url}'>Перейти в Resonance</a>"
    )


async def send_morning_digest():
    logger.info("Starting morning digest process")
    settings = get_settings()

    with SessionLocal() as db:
        projects = db.scalars(select(Project)).all()
        for project in projects:
            config = project.config_json or {}
            if not config.get("morning_digest_enabled"):
                logger.info("Morning digest disabled for project '%s'", project.name)
                continue

            forwarded_tickets = db.scalars(
                select(Ticket).where(
                    and_(
                        Ticket.project_id == project.id,
                        Ticket.status == TicketStatus.FORWARDED,
                    )
                )
            ).all()

            if not forwarded_tickets:
                logger.info("No FORWARDED tickets for project '%s', skipping morning digest", project.name)
                continue

            room_id = _main_project_room(config)
            if not room_id:
                logger.warning("No main project room configured for project '%s', skipping morning digest", project.name)
                continue

            tags: set[str] = set()
            for ticket in forwarded_tickets:
                if ticket.assignee_id:
                    assignee = db.get(User, ticket.assignee_id)
                    if assignee and assignee.matrix_id:
                        tags.add(assignee.matrix_id)

                epic_name = ticket.data_json.get("epic_name")
                if not epic_name:
                    continue

                epic = db.scalar(
                    select(Epic).where(
                        Epic.project_id == project.id,
                        Epic.title == epic_name,
                    )
                )
                if not epic:
                    continue

                direction = ticket.data_json.get("target_direction")
                if direction == "analytics" and epic.lead_analyst_id:
                    user = db.get(User, epic.lead_analyst_id)
                    if user and user.matrix_id:
                        tags.add(user.matrix_id)

                if direction == "design" and epic.lead_designer_id:
                    user = db.get(User, epic.lead_designer_id)
                    if user and user.matrix_id:
                        tags.add(user.matrix_id)

            tag_links = [_matrix_link(matrix_id) for matrix_id in sorted(tags)]
            tags_str = ", ".join(tag_links) if tag_links else "Ответственные не назначены"
            message = _morning_digest_message(
                project_name=project.name,
                count=len(forwarded_tickets),
                tags_str=tags_str,
                project_id=project.id,
                frontend_url=settings.frontend_url,
            )

            period_end = datetime.utcnow()
            period_start = period_end.replace(hour=0, minute=0, second=0, microsecond=0)
            try:
                logger.info("Sending morning digest for project '%s' to room %s", project.name, room_id)
                resp = await matrix_bot.send_room(room_id, message)
                event_id = resp.get("event_id") if isinstance(resp, dict) else None
                status = "sent" if event_id else "failed"
                if isinstance(resp, dict) and resp.get("event_id"):
                    logger.info("Morning digest sent! Event ID: %s", resp["event_id"])
                else:
                    logger.error("Failed to send morning digest to room %s: %s", room_id, resp)
                db.add(
                    DigestRun(
                        project_id=project.id,
                        kind="morning",
                        period_start=period_start,
                        period_end=period_end,
                        status=status,
                        snapshot_json={
                            "room_id": room_id,
                            "ticket_count": len(forwarded_tickets),
                        },
                        matrix_room_id=room_id,
                        matrix_event_id=event_id,
                        error_message=None if status == "sent" else str(resp),
                    )
                )
                db.commit()
            except Exception as exc:
                logger.error("Matrix transport error sending morning digest: %s", exc)
                db.add(
                    DigestRun(
                        project_id=project.id,
                        kind="morning",
                        period_start=period_start,
                        period_end=period_end,
                        status="failed",
                        snapshot_json={"room_id": room_id},
                        matrix_room_id=room_id,
                        matrix_event_id=None,
                        error_message=str(exc)[:1024],
                    )
                )
                db.commit()


async def send_evening_digest():
    logger.info("Starting evening digest process")
    settings = get_settings()
    today_start = _moscow_day_start_as_utc_naive()

    with SessionLocal() as db:
        projects = db.scalars(select(Project)).all()
        for project in projects:
            config = project.config_json or {}
            if not config.get("evening_digest_enabled"):
                logger.info("Evening digest disabled for project '%s'", project.name)
                continue

            asked_today = db.scalar(
                select(func.count(Ticket.id)).where(
                    and_(
                        Ticket.project_id == project.id,
                        Ticket.created_at >= today_start,
                    )
                )
            ) or 0

            answered_today = db.scalar(
                select(func.count(func.distinct(TicketEvent.ticket_id)))
                .join(Ticket, Ticket.id == TicketEvent.ticket_id)
                .where(
                    and_(
                        Ticket.project_id == project.id,
                        TicketEvent.kind == TicketEventKind.STATUS_CHANGED.value,
                        TicketEvent.new_value == TicketStatus.ANSWERED.value,
                        TicketEvent.created_at >= today_start,
                    )
                )
            ) or 0

            open_statuses = (
                TicketStatus.FORWARDED,
                TicketStatus.RETURNED,
                TicketStatus.ANSWERED,
            )
            status_counts = {status: 0 for status in open_statuses}
            status_rows = db.execute(
                select(Ticket.status, func.count(Ticket.id))
                .where(
                    and_(
                        Ticket.project_id == project.id,
                        Ticket.status.in_(open_statuses),
                    )
                )
                .group_by(Ticket.status)
            ).all()
            for status, count in status_rows:
                status_counts[status] = int(count or 0)
            open_total = sum(status_counts.values())

            room_id = _main_project_room(config)
            if not room_id:
                logger.warning("No main project room configured for project '%s', skipping evening digest", project.name)
                continue

            message = _evening_digest_message(
                project_name=project.name,
                asked_today=asked_today,
                answered_today=answered_today,
                open_total=open_total,
                status_counts=status_counts,
                frontend_url=settings.frontend_url,
            )

            logger.info("Sending evening digest for project '%s' to room %s", project.name, room_id)
            period_end = datetime.utcnow()
            period_start = today_start
            try:
                resp = await matrix_bot.send_room(room_id, message)
                event_id = resp.get("event_id") if isinstance(resp, dict) else None
                status = "sent" if event_id else "failed"
                if isinstance(resp, dict) and resp.get("event_id"):
                    logger.info("Evening digest sent! Event ID: %s", resp["event_id"])
                else:
                    logger.error("Failed to send evening digest to room %s: %s", room_id, resp)
                db.add(
                    DigestRun(
                        project_id=project.id,
                        kind="evening",
                        period_start=period_start,
                        period_end=period_end,
                        status=status,
                        snapshot_json={
                            "asked_today": asked_today,
                            "answered_today": answered_today,
                            "open_total": open_total,
                            "status_counts": {status.value: count for status, count in status_counts.items()},
                            "room_id": room_id,
                        },
                        matrix_room_id=room_id,
                        matrix_event_id=event_id,
                        error_message=None if status == "sent" else str(resp),
                    )
                )
                db.commit()
            except Exception as exc:
                logger.error("Matrix transport error sending evening digest: %s", exc)
                db.add(
                    DigestRun(
                        project_id=project.id,
                        kind="evening",
                        period_start=period_start,
                        period_end=period_end,
                        status="failed",
                        snapshot_json={
                            "asked_today": asked_today,
                            "answered_today": answered_today,
                            "open_total": open_total,
                            "status_counts": {status.value: count for status, count in status_counts.items()},
                        },
                        matrix_room_id=room_id,
                        matrix_event_id=None,
                        error_message=str(exc)[:1024],
                    )
                )
                db.commit()


async def send_ticket_stagnation_sla_warnings():
    """Уведомления «Вопрос долго без движения» лидам и assignee, если вопрос не обновлялся ≥ 2 суток."""
    logger.info("Checking tickets for stagnation (48h without update)")
    threshold = datetime.utcnow() - timedelta(days=2)
    active_statuses = (
        TicketStatus.PENDING_APPROVAL,
        TicketStatus.FORWARDED,
        TicketStatus.RETURNED,
    )
    with SessionLocal() as db:
        ticket_ids = db.scalars(
            select(Ticket.id).where(
                Ticket.updated_at <= threshold,
                Ticket.status.in_(active_statuses),
            )
        ).all()
        if not ticket_ids:
            logger.info("No stagnant tickets for stagnation notify")
            return
        logger.info("Stagnation notify: %d ticket(s) to evaluate", len(ticket_ids))
        for tid in ticket_ids:
            try:
                await notification_service.notify_ticket_stagnation_sla_warning(db, tid)
            except Exception:
                logger.exception("Stagnation notify failed for ticket %s", tid)


async def flush_outbound_notification_jobs():
    try:
        n = await process_pending_outbound_jobs(limit=40)
        if n:
            logger.info("Processed %s outbound notification job(s)", n)
    except Exception:
        logger.exception("Outbound notification worker failed")


async def run_escalation_scheduler():
    try:
        with SessionLocal() as db:
            created = run_escalation_pass(db)
            if created:
                logger.info("Escalation scheduler created %s reminder(s)", created)
    except Exception:
        logger.exception("Escalation scheduler failed")


async def run_retention_cleanup():
    try:
        with SessionLocal() as db:
            purge_old_delivery_attempts(db, days=180)
            purge_old_domain_event_logs(db, days=90)
    except Exception:
        logger.exception("Retention cleanup failed")


def _refresh_kanban_analytics_snapshot_sync() -> dict[str, Any] | None:
    with SessionLocal() as db:
        return refresh_kanban_analytics_snapshot_from_scheduler(db)


async def refresh_kanban_analytics_snapshot_cron():
    """Периодическое обновление снимка Kanban для аналитики (тяжёлые HTTP-запросы — в thread pool)."""
    try:
        stored = await asyncio.to_thread(_refresh_kanban_analytics_snapshot_sync)
        if not stored:
            return
        logger.info(
            "Kanban analytics snapshot refreshed: updated_at=%s projects=%s epics=%s tasks=%s",
            stored.get("updated_at"),
            len(stored.get("projects") or []),
            len(stored.get("epics") or []),
            len(stored.get("tasks") or []),
        )
    except Exception:
        logger.exception("Kanban analytics snapshot cron failed")


async def run_startup_digest_test():
    logger.info("Starting startup digest test")
    try:
        await send_morning_digest()
    except Exception as exc:
        logger.error("Startup morning digest test failed: %s", exc)
    try:
        await send_evening_digest()
    except Exception as exc:
        logger.error("Startup evening digest test failed: %s", exc)
    logger.info("Startup digest test finished")


def start_scheduler():
    scheduler = AsyncIOScheduler()

    scheduler.add_job(
        send_morning_digest,
        CronTrigger(day_of_week="mon-fri", hour=9, minute=0, timezone=_SCHEDULER_TZ),
        id="morning_digest",
    )

    scheduler.add_job(
        send_evening_digest,
        CronTrigger(day_of_week="mon-fri", hour=19, minute=0, timezone=_SCHEDULER_TZ),
        id="evening_digest",
    )

    scheduler.add_job(
        send_ticket_stagnation_sla_warnings,
        CronTrigger(hour="*/6", minute=40),
        id="ticket_sla_stagnation",
    )

    scheduler.add_job(
        flush_outbound_notification_jobs,
        IntervalTrigger(seconds=45),
        id="notification_outbound_worker",
    )

    scheduler.add_job(
        run_escalation_scheduler,
        CronTrigger(minute=22),
        id="notification_escalation",
    )

    scheduler.add_job(
        run_retention_cleanup,
        CronTrigger(day_of_week="sun", hour=4, minute=10),
        id="notification_retention_cleanup",
    )

    scheduler.add_job(
        refresh_kanban_analytics_snapshot_cron,
        CronTrigger(hour=18, minute=30, timezone=_SCHEDULER_TZ),
        id="kanban_analytics_snapshot_refresh",
    )

    scheduler.start()
    logger.info(
        "APScheduler started (digests Mon–Fri; evening 19:00 Europe/Moscow; stagnation every 6h; outbound ~45s; hourly escalation; weekly retention; Kanban snapshot 18:30 Europe/Moscow daily)"
    )
