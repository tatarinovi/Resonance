"""Ticket follower subscriptions (watch list)."""

from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .models import TicketSubscriber


def ensure_ticket_subscriber(db: Session, ticket_id: int, user_id: int) -> None:
    exists = db.scalar(
        select(TicketSubscriber.ticket_id).where(
            TicketSubscriber.ticket_id == ticket_id,
            TicketSubscriber.user_id == user_id,
        )
    )
    if exists is not None:
        return
    db.add(TicketSubscriber(ticket_id=ticket_id, user_id=user_id))


def remove_ticket_subscriber(db: Session, ticket_id: int, user_id: int) -> None:
    db.execute(
        delete(TicketSubscriber).where(
            TicketSubscriber.ticket_id == ticket_id,
            TicketSubscriber.user_id == user_id,
        )
    )


def list_subscriber_user_ids(db: Session, ticket_id: int) -> list[int]:
    return list(db.scalars(select(TicketSubscriber.user_id).where(TicketSubscriber.ticket_id == ticket_id)).all())


def is_user_subscribed(db: Session, ticket_id: int, user_id: int) -> bool:
    row = db.scalar(
        select(TicketSubscriber.ticket_id).where(
            TicketSubscriber.ticket_id == ticket_id,
            TicketSubscriber.user_id == user_id,
        )
    )
    return row is not None
