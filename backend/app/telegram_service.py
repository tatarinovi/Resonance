import logging
import httpx
from .config import get_settings
from .models import User

logger = logging.getLogger(__name__)

class TelegramService:
    def __init__(self):
        self.settings = get_settings()
        self.base_url = f"https://api.telegram.org/bot{self.settings.telegram_bot_token}"

    async def send_notification(self, user: User, message: str):
        if not user.telegram_id or not user.telegram_notifications:
            return

        if not self.settings.telegram_bot_token:
            logger.warning("Telegram Bot Token is not set. Skipping notification.")
            return

        # Handle @username vs chat_id
        # For sending by nickname, the user must have started the bot.
        # However, Telegram API typically requires `chat_id` (integer).
        # We assume the user saved their chat_id or the bot handles it.
        # For simplicity, we just try to send to what's in telegram_id.
        chat_id = user.telegram_id.replace("@", "") if user.telegram_id.startswith("@") else user.telegram_id

        client_kwargs = {"timeout": 10.0, "trust_env": False}
        if self.settings.telegram_proxy_url:
            client_kwargs["proxy"] = self.settings.telegram_proxy_url

        async with httpx.AsyncClient(**client_kwargs) as client:
            try:
                resp = await client.post(
                    f"{self.base_url}/sendMessage",
                    json={
                        "chat_id": chat_id,
                        "text": message,
                        "parse_mode": "HTML"
                    }
                )
                resp.raise_for_status()
                logger.info(f"Telegram notification sent to {user.username}")
            except Exception as e:
                import traceback
                logger.error(f"Failed to send Telegram notification to {user.username}: {e}")
                logger.error(traceback.format_exc())

telegram_service = TelegramService()
