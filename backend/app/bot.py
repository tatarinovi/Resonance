import asyncio
import logging

from app.bootstrap import bootstrap_database
from app.config import get_settings
from app.matrix_service import matrix_bot
from app.scheduler import run_startup_digest_test, start_scheduler
from app.telegram_bot import telegram_bot


logging.basicConfig(level=logging.INFO)
logging.getLogger("nio").setLevel(logging.WARNING)
logging.getLogger("nio.rooms").setLevel(logging.WARNING)
logging.getLogger("nio.events.misc").setLevel(logging.ERROR)
logging.getLogger("nio.responses").setLevel(logging.ERROR)


async def main() -> None:
    logging.info("Bot process starting")
    settings = get_settings()
    bootstrap_database(run_migrations=False)
    start_scheduler()
    if settings.run_startup_digest_test:
        await run_startup_digest_test()
    else:
        logging.info("Startup digest test disabled by RUN_STARTUP_DIGEST_TEST=false")

    tasks = [matrix_bot.run()]
    if settings.telegram_enabled:
        tasks.append(telegram_bot.run())
    else:
        logging.info("Telegram bot disabled by TELEGRAM_ENABLED=false")
    await asyncio.gather(*tasks)


if __name__ == "__main__":
    asyncio.run(main())
