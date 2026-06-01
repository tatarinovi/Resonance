# Kanban legacy task polling (операции)

Опрос DS Kanban `GET /user/{id}/task/legacy` (раз в **15 секунд**) и создание персональных уведомлений выполняется в **процессе API** (`uvicorn app.main:app`): при старте приложения поднимается фоновая asyncio-задача в [`backend/app/main.py`](../app/main.py) (`_kanban_legacy_poll_loop`).

### Почему не в `app.bot`

Шина SSE (`backend/app/realtime.py`) и подписчики `/api/stream` живут **в памяти процесса API**. Вызовы `publish_event` из **другого процесса** (бот с APScheduler) до открытых вкладок **не доходят**, поэтому колокольчик обновлялся только после полного refetch (например, перезагрузка страницы).

### Где логика

- Опрос и уведомления: [`backend/app/kanban_legacy_poll_service.py`](../app/kanban_legacy_poll_service.py)
- Baseline / дедуп: таблица `kanban_legacy_task_seen` (миграция `0013_kanban_legacy_task_seen`)

### Замечания по деплою

- Для корректного real-time достаточно запущенного **API**; отдельный **bot** для этого опроса не нужен.
- При **нескольких воркерах uvicorn** у каждого процесса свой in-memory bus: пользователь может попасть на воркер без его SSE — ограничение той же архитектуры. Обычно используют один воркер или sticky-сессии к тому же процессу.
