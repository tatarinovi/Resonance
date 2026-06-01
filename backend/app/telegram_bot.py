import asyncio
import logging
import httpx
from datetime import datetime
from sqlalchemy import select
from app.database import SessionLocal
from app.models import User, TelegramLinkingToken
from app.config import get_settings

logger = logging.getLogger(__name__)

class TelegramBot:
    def __init__(self):
        self.settings = get_settings()
        self.token = self.settings.telegram_bot_token
        self.base_url = f"https://api.telegram.org/bot{self.token}"
        self.offset = 0

    async def run(self):
        if not self.settings.telegram_enabled:
            logger.warning("TELEGRAM_ENABLED=false. Telegram bot listener disabled.")
            return
        if not self.token:
            logger.warning("TELEGRAM_BOT_TOKEN not set. Telegram bot listener disabled.")
            return

        logger.info(f"Starting Telegram bot listener (polling) with token: {self.token[:5]}...{self.token[-5:]}")
        
        client_kwargs = {"timeout": 40.0, "trust_env": False}
        if self.settings.telegram_proxy_url:
            logger.info(f"Using proxy: {self.settings.telegram_proxy_url}")
            client_kwargs["proxy"] = self.settings.telegram_proxy_url

        async with httpx.AsyncClient(**client_kwargs) as client:
            # Clear any existing webhooks and DROP pending updates to start fresh
            try:
                logger.info("Cleaning up Telegram state (deleteWebhook)...")
                drop_resp = await client.get(f"{self.base_url}/deleteWebhook", params={"drop_pending_updates": "true"})
                logger.info(f"deleteWebhook response: {drop_resp.text}")
            except Exception as e:
                logger.warning(f"Failed to delete webhook: {e}")

            while True:
                try:
                    resp = await client.get(
                        f"{self.base_url}/getUpdates",
                        params={"offset": self.offset, "timeout": 20}
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    
                    if not data.get("ok"):
                        logger.error(f"Telegram API Error: {data}")
                        await asyncio.sleep(5)
                        continue

                    updates = data.get("result", [])
                    
                    if updates:
                        logger.info(f"Received {len(updates)} updates from Telegram")
                    else:
                        # logger.debug("No new updates")
                        pass

                    for update in updates:
                        self.offset = update["update_id"] + 1
                        if "message" in update:
                            msg = update["message"]
                            sender = msg.get("from", {}).get("username") or msg.get("from", {}).get("id")
                            logger.info(f"Processing message from {sender} (chat {msg['chat']['id']}): {msg.get('text', '[no text]')}")
                            await self.handle_message(msg)
                            
                except Exception as e:
                    logger.error(f"Telegram polling error: {e}")
                    import traceback
                    logger.error(traceback.format_exc())
                    await asyncio.sleep(5)

    async def handle_message(self, message):
        chat_id = message["chat"]["id"]
        text = message.get("text", "")
        
        if text.startswith("/start"):
            parts = text.split()
            if len(parts) > 1 and parts[1].startswith("link_"):
                token_val = parts[1].replace("link_", "")
                await self.handle_linking(chat_id, token_val)
            else:
                await self.send_welcome(chat_id)

    async def handle_linking(self, chat_id, token_val):
        with SessionLocal() as db:
            linking_token = db.scalar(
                select(TelegramLinkingToken).where(
                    TelegramLinkingToken.token == token_val,
                    TelegramLinkingToken.expires_at > datetime.utcnow()
                )
            )
            
            if not linking_token:
                await self.send_message(chat_id, "❌ Ссылка устарела или неверна. Попробуйте еще раз из личного кабинета.")
                return

            user = db.get(User, linking_token.user_id)
            if user:
                user.telegram_id = str(chat_id)
                user.telegram_notifications = True
                db.delete(linking_token)
                db.commit()
                await self.send_message(chat_id, f"✅ Аккаунт <b>{user.username}</b> успешно привязан! Теперь вы будете получать уведомления здесь.")
            else:
                await self.send_message(chat_id, "❌ Пользователь не найден.")

    async def send_welcome(self, chat_id):
        welcome_text = (
            "👋 <b>Добро пожаловать в Resonance Bot!</b>\n\n"
            "Я буду присылать вам уведомления о новых вопросах и ответах.\n\n"
            f"Ваш Telegram ID: <code>{chat_id}</code>\n"
            "Используйте его для привязки в профиле Resonance."
        )
        await self.send_message(chat_id, welcome_text)

    async def send_message(self, chat_id, text):
        client_kwargs = {"timeout": 10.0, "trust_env": False}
        if self.settings.telegram_proxy_url:
            client_kwargs["proxy"] = self.settings.telegram_proxy_url
            
        async with httpx.AsyncClient(**client_kwargs) as client:
            try:
                await client.post(
                    f"{self.base_url}/sendMessage",
                    json={
                        "chat_id": chat_id,
                        "text": text,
                        "parse_mode": "HTML"
                    }
                )
            except Exception as e:
                import traceback
                logger.error(f"Failed to send message to {chat_id}: {e}")
                logger.error(traceback.format_exc())

telegram_bot = TelegramBot()
