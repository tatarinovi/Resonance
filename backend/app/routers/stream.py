"""Server-Sent Events stream for live UI updates."""
from __future__ import annotations

import asyncio
import logging
import os

from fastapi import APIRouter, Header, HTTPException, status as http_status
from fastapi.responses import StreamingResponse

from ..deps import get_current_user_from_token
from ..realtime import StreamEvent, bus

router = APIRouter(tags=["stream"])
logger = logging.getLogger(__name__)


HEARTBEAT_SECONDS = int(os.getenv("STREAM_HEARTBEAT_SECONDS", "25"))


@router.get("/stream")
async def stream(
    authorization: str | None = Header(default=None),
):
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=http_status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    user = get_current_user_from_token(token)
    if user is None:
        raise HTTPException(status_code=http_status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    async def event_generator():
        bus.attach_loop(asyncio.get_event_loop())
        async with bus.subscribe(user.id) as queue:
            yield StreamEvent(type="hello", payload={"user_id": user.id}).to_sse()
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
                    yield event.to_sse()
                except asyncio.TimeoutError:
                    yield "event: ping\ndata: {}\n\n"
                except asyncio.CancelledError:
                    break

    headers = {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=headers)
