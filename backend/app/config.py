from functools import lru_cache

from cryptography.fernet import Fernet
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
    integration_credentials_fernet_key: str = ""
    integration_connection_check_timeout_seconds: int = 20
    epic_jira_refresh_timeout_seconds: int = 30
    epic_jira_page_size: int = 100
    epic_jira_max_issues: int = 1000
    release_external_data_stale_hours: int = 24
    release_refresh_request_timeout_seconds: int = 30
    release_refresh_wall_clock_seconds: int = 90
    release_refresh_concurrency: int = 3
    jira_blocker_priority_names: str = "blocker,блокирующий"
    jira_critical_priority_names: str = "critical,критический"

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
    s3_endpoint: str = "http://minio:9000"
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

        try:
            Fernet(self.integration_credentials_fernet_key.encode("utf-8"))
        except (TypeError, ValueError) as exc:
            raise ValueError("INTEGRATION_CREDENTIALS_FERNET_KEY must be a valid Fernet key.") from exc

        if self.integration_connection_check_timeout_seconds < 1:
            raise ValueError("INTEGRATION_CONNECTION_CHECK_TIMEOUT_SECONDS must be positive.")
        if min(self.epic_jira_refresh_timeout_seconds, self.epic_jira_page_size, self.epic_jira_max_issues) < 1:
            raise ValueError("Epic Jira refresh limits must be positive.")
        if min(
            self.release_external_data_stale_hours,
            self.release_refresh_request_timeout_seconds,
            self.release_refresh_wall_clock_seconds,
            self.release_refresh_concurrency,
        ) < 1:
            raise ValueError("Release refresh and freshness settings must be positive.")

        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
