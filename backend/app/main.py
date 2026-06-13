import asyncio
import logging
import sys
import traceback
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .bootstrap import bootstrap_database
from .config import get_settings
from .correlation_middleware import CorrelationMiddleware
from .kanban_legacy_poll_service import kanban_legacy_poll_once
from .realtime import bus
from .routers import (
    activity,
    admin,
    aggregates,
    analytics,
    auth,
    kanban,
    dashboard,
    epics,
    feedback,
    files,
    notifications,
    reference,
    stream,
)

# Configure logging to stdout
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("matrix-hub")
poll_logger = logging.getLogger(__name__)

settings = get_settings()
app = FastAPI(title=settings.app_name, openapi_url=f"{settings.api_prefix}/openapi.json")

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Catch-all for unhandled exceptions.
    Logs full traceback and returns 500.
    """
    logger.error(f"Unhandled error during {request.method} {request.url}")
    logger.error(traceback.format_exc())
    
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. Check logs for details."}
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(CorrelationMiddleware)


async def _kanban_legacy_poll_loop() -> None:
    """Runs in API process so `publish_event` reaches SSE subscribers (same in-memory bus as `/stream`)."""
    while True:
        try:
            await asyncio.to_thread(kanban_legacy_poll_once)
        except Exception:
            poll_logger.exception("Kanban legacy poll iteration failed")
        await asyncio.sleep(15)


@app.on_event("startup")
async def on_startup() -> None:
    bootstrap_database(run_migrations=settings.run_migrations_on_startup)
    bus.attach_loop(asyncio.get_running_loop())
    asyncio.create_task(_kanban_legacy_poll_loop())


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/docs", include_in_schema=False)
async def scalar_docs():
    html = """<!doctype html>
<html>
<head>
  <title>Resonance API — Scalar</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
</head>
<body>
  <script id="api-reference" data-url="/api/openapi.json"></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>"""
    return HTMLResponse(content=html)


app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(admin.router, prefix=settings.api_prefix)
app.include_router(dashboard.router, prefix=settings.api_prefix)
app.include_router(epics.router, prefix=settings.api_prefix)
app.include_router(feedback.router, prefix=settings.api_prefix)
app.include_router(files.router, prefix=settings.api_prefix)
app.include_router(analytics.router, prefix=settings.api_prefix)
app.include_router(kanban.router, prefix=settings.api_prefix)
app.include_router(notifications.router, prefix=settings.api_prefix)
app.include_router(activity.router, prefix=settings.api_prefix)
app.include_router(reference.router, prefix=settings.api_prefix)
app.include_router(aggregates.router, prefix=settings.api_prefix)
app.include_router(stream.router, prefix=settings.api_prefix)
