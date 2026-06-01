"""In-process pub/sub for SSE realtime updates.

This module provides a tiny per-user event bus backed by ``asyncio.Queue``.
Routers call :func:`publish_event` synchronously after committing changes;
SSE consumers connect via :func:`subscribe` and yield events as they arrive.

The bus is in-memory only: it's perfectly fine for a single-process FastAPI
deployment (which is our setup behind Caddy). For horizontal scaling we'd
need Redis pub/sub or another broker — out of scope for this iteration.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, AsyncIterator, Iterable

logger = logging.getLogger(__name__)


@dataclass
class StreamEvent:
    type: str
    payload: dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.utcnow)

    def to_sse(self) -> str:
        body = json.dumps(self.payload, default=str)
        return f"event: {self.type}\ndata: {body}\n\n"


class EventBus:
    """Per-user fan-out queues.

    A user may have multiple open EventSource connections (e.g. multiple tabs);
    each subscription has its own queue and receives all events published for
    that user.
    """

    def __init__(self) -> None:
        self._channels: dict[int, set[asyncio.Queue[StreamEvent]]] = defaultdict(set)
        self._broadcast: set[asyncio.Queue[StreamEvent]] = set()
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def attach_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    @asynccontextmanager
    async def subscribe(self, user_id: int) -> AsyncIterator[asyncio.Queue[StreamEvent]]:
        queue: asyncio.Queue[StreamEvent] = asyncio.Queue(maxsize=256)
        async with self._lock:
            self._channels[user_id].add(queue)
        try:
            yield queue
        finally:
            async with self._lock:
                self._channels[user_id].discard(queue)
                if not self._channels[user_id]:
                    del self._channels[user_id]

    @asynccontextmanager
    async def subscribe_broadcast(self) -> AsyncIterator[asyncio.Queue[StreamEvent]]:
        queue: asyncio.Queue[StreamEvent] = asyncio.Queue(maxsize=256)
        async with self._lock:
            self._broadcast.add(queue)
        try:
            yield queue
        finally:
            async with self._lock:
                self._broadcast.discard(queue)

    def publish(self, user_ids: Iterable[int], event: StreamEvent) -> None:
        loop = self._loop
        if loop is None:
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                logger.debug("publish() called outside event loop; dropping event %s", event.type)
                return

        targets: list[asyncio.Queue[StreamEvent]] = []
        for uid in set(user_ids):
            for queue in self._channels.get(uid, ()):
                targets.append(queue)
        for queue in self._broadcast:
            targets.append(queue)

        for queue in targets:
            try:
                if loop.is_running():
                    loop.call_soon_threadsafe(self._safe_put, queue, event)
                else:
                    queue.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("SSE queue full; dropping event %s", event.type)
            except Exception:
                logger.exception("Failed to enqueue SSE event %s", event.type)

    @staticmethod
    def _safe_put(queue: asyncio.Queue[StreamEvent], event: StreamEvent) -> None:
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            logger.warning("SSE queue full; dropping event %s", event.type)


bus = EventBus()


def publish_event(user_ids: Iterable[int], type: str, payload: dict[str, Any] | None = None) -> None:
    bus.publish(user_ids, StreamEvent(type=type, payload=payload or {}))


def publish_broadcast(type: str, payload: dict[str, Any] | None = None) -> None:
    bus.publish((), StreamEvent(type=type, payload=payload or {}))
