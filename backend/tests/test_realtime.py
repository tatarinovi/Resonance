"""Smoke tests for the in-process SSE event bus."""
from __future__ import annotations

import asyncio

import pytest

from app.realtime import StreamEvent, bus, publish_event


@pytest.mark.asyncio
async def test_publish_to_subscribed_user_receives_event():
    bus.attach_loop(asyncio.get_event_loop())

    received: list[StreamEvent] = []

    async with bus.subscribe(user_id=42) as queue:
        publish_event([42], "ticket.updated", {"ticket_id": 7})
        event = await asyncio.wait_for(queue.get(), timeout=1.0)
        received.append(event)

    assert len(received) == 1
    assert received[0].type == "ticket.updated"
    assert received[0].payload == {"ticket_id": 7}


@pytest.mark.asyncio
async def test_unsubscribed_user_does_not_receive_targeted_event():
    bus.attach_loop(asyncio.get_event_loop())

    async with bus.subscribe(user_id=1) as queue_one:
        publish_event([2], "ticket.updated", {"ticket_id": 7})
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(queue_one.get(), timeout=0.1)
