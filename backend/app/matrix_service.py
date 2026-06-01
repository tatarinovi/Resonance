from __future__ import annotations

import logging
import re
from asyncio import sleep
from urllib.parse import quote

import httpx
from nio import AsyncClient, LoginResponse, SyncError, SyncResponse

from app.config import get_settings
from app.database import SessionLocal
from app.models import AppSetting


LOGGER = logging.getLogger(__name__)
SESSION_KEY = "matrix_bot_session"


class MatrixBotService:
    def __init__(self) -> None:
        self.settings = get_settings()
        persisted = self._load_persisted_session()
        self._user_id = self.settings.matrix_user_id
        self._access_token = self.settings.matrix_access_token or persisted.get("access_token") or ""
        self._device_id = self.settings.matrix_device_id or persisted.get("device_id") or None
        self.client = self._build_client()

    def _build_client(self) -> AsyncClient:
        return AsyncClient(
            self.settings.matrix_homeserver,
            self._user_id,
            device_id=self._device_id,
        )

    def _load_persisted_session(self) -> dict[str, str]:
        try:
            with SessionLocal() as db:
                setting = db.get(AppSetting, SESSION_KEY)
                if setting and isinstance(setting.value_json, dict):
                    return setting.value_json
        except Exception as exc:
            LOGGER.warning("Failed to load persisted Matrix session: %s", exc)
        return {}

    def _persist_session(self) -> None:
        if not self._access_token:
            return
        try:
            with SessionLocal() as db:
                payload = {
                    "user_id": self._user_id,
                    "access_token": self._access_token,
                    "device_id": self._device_id,
                }
                setting = db.get(AppSetting, SESSION_KEY)
                if not setting:
                    setting = AppSetting(key=SESSION_KEY, value_json=payload)
                    db.add(setting)
                else:
                    setting.value_json = payload
                db.commit()
        except Exception as exc:
            LOGGER.warning("Failed to persist Matrix session: %s", exc)

    def _restore_token(self) -> None:
        self.client.access_token = self._access_token
        self.client.user_id = self._user_id
        if self._device_id:
            self.client.device_id = self._device_id

    async def login(self) -> None:
        if self._access_token and self._device_id:
            LOGGER.info("Restoring Matrix session with access token and device id")
            self.client.restore_login(
                user_id=self._user_id,
                device_id=self._device_id,
                access_token=self._access_token,
            )
            self._restore_token()
            self._persist_session()
            return

        if self._access_token:
            LOGGER.info("Restoring Matrix session with access token only")
            self._restore_token()
            self._persist_session()
            return

        if self.settings.matrix_password:
            LOGGER.info("Logging in to Matrix with password")
            resp = await self.client.login(
                password=self.settings.matrix_password,
                device_name="Resonance Hub Bot",
            )
            if isinstance(resp, LoginResponse):
                self._device_id = resp.device_id
                self._access_token = resp.access_token
                self._restore_token()
                self._persist_session()
                LOGGER.info("Matrix login successful, device_id=%s", resp.device_id)
                return
            raise RuntimeError(f"Matrix login failed: {resp}")

        raise RuntimeError("MATRIX_ACCESS_TOKEN or MATRIX_PASSWORD required")

    async def ensure_session(self) -> None:
        if not self.client.access_token:
            LOGGER.warning("Matrix session missing, re-authenticating")
            await self.login()
        else:
            self._restore_token()

    def _build_message_content(self, message: str) -> dict[str, str]:
        plain_body = re.sub(r"<[^>]+>", "", message)
        content = {"msgtype": "m.text", "body": plain_body}
        if any(tag in message for tag in ("<b>", "<i>", "<a", "<br")):
            formatted_body = message.replace("\r\n", "\n").replace("\n", "<br>")
            content["format"] = "org.matrix.custom.html"
            content["formatted_body"] = formatted_body
        return content

    async def send_room(self, room_id: str, message: str):
        await self.ensure_session()
        homeserver = self.settings.matrix_homeserver.rstrip("/")
        encoded_room_id = quote(room_id, safe="")
        url = f"{homeserver}/_matrix/client/v3/rooms/{encoded_room_id}/send/m.room.message"
        headers = {
            "Authorization": f"Bearer {self.client.access_token}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=30.0, trust_env=False) as client:
            response = await client.post(
                url,
                headers=headers,
                json=self._build_message_content(message),
            )
            response.raise_for_status()
            return response.json()

    async def send_dm(self, user_id: str, message: str) -> None:
        await self.ensure_session()

        target_room_id = None
        for room_id, room in self.client.rooms.items():
            if room.is_group:
                continue
            if user_id in room.users and len(room.users) <= 2:
                target_room_id = room_id
                break

        if not target_room_id:
            LOGGER.info("Creating new DM room for user %s", user_id)
            resp = await self.client.room_create(
                invite=[user_id],
                is_direct=True,
                preset="trusted_private_chat",
            )
            target_room_id = getattr(resp, "room_id", None)

        if target_room_id:
            await self.send_room(target_room_id, message)
            LOGGER.info("Matrix DM sent to %s", user_id)
        else:
            LOGGER.error("Failed to find or create DM room for %s", user_id)

    async def run(self) -> None:
        await self.login()
        LOGGER.info("Matrix bot started")

        consecutive_errors = 0
        while True:
            try:
                await self.ensure_session()
                response = await self.client.sync(
                    timeout=self.settings.matrix_sync_timeout_ms,
                    full_state=False,
                )
                if isinstance(response, SyncResponse):
                    consecutive_errors = 0
                    continue
                if isinstance(response, SyncError):
                    LOGGER.error("Matrix sync error: %s (%s)", response.message, response.status_code)
                    consecutive_errors += 1
            except Exception as exc:
                LOGGER.error("Unexpected error in matrix sync loop: %s", exc)
                consecutive_errors += 1

            await sleep(min(5 * consecutive_errors, 60))


matrix_bot = MatrixBotService()
