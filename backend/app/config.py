from functools import lru_cache

from pydantic import model_validator

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Resonance Hub"
    api_prefix: str = "/api"
    frontend_url: str = "https://resonance.tatarinovi.ru"
    database_url: str = "postgresql+psycopg://matrix:matrix@db:5432/matrixhub"
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 4320
    default_admin_username: str = ""
    default_admin_password: str = ""
    cors_origins: str = "http://localhost:5173,http://frontend"
    run_migrations_on_startup: bool = True
    run_startup_digest_test: bool = False

    matrix_homeserver: str = "https://matrix.example.com"
    matrix_user_id: str = "@bot:example.com"
    matrix_access_token: str = ""
    matrix_password: str = ""
    matrix_device_id: str = ""
    matrix_sync_timeout_ms: int = 30000

    telegram_bot_token: str = ""
    telegram_bot_name: str = "ResonanceBot"
    telegram_proxy_url: str = ""
    matrix_dm_enabled: bool = False
    telegram_enabled: bool = False

    # MinIO / S3 Storage
    s3_endpoint: str = "http://matrix-minio:9000"
    s3_access_key: str = "matrix"
    s3_secret_key: str = "matrix123"
    s3_bucket: str = "attachments"
    s3_public_url: str = "https://resonance.tatarinovi.ru/files" # Through Caddy
    max_upload_size_mb: int = 10

    kanban_api_base_url: str = "https://kanban.devds.ru/api"
    kanban_api_token: str = ""
    kanban_timeout_seconds: int = 20
    #: Размер страницы при выгрузке задач в bundle (GET /project/{slug}/task).
    kanban_bundle_task_page_size: int = 250
    #: Кэш ответа bundle в памяти процесса, секунды; 0 — отключить.
    kanban_bundle_cache_ttl_seconds: int = 45

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @model_validator(mode="after")
    def validate_security_defaults(self) -> "Settings":
        jwt_secret = self.jwt_secret.strip()
        if not jwt_secret:
            raise ValueError("JWT_SECRET must be configured before startup.")
        if jwt_secret.lower() in {"change-me", "changeme", "secret", "default", "admin"}:
            raise ValueError("JWT_SECRET cannot use an insecure placeholder value.")
        if len(jwt_secret) < 16:
            raise ValueError("JWT_SECRET must contain at least 16 characters.")

        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
