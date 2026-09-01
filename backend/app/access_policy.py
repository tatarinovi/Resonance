from .models import Epic, EpicQAStatus, Release, ReleaseStatus, User, UserRole


def is_coordinator_role(user: User) -> bool:
    return user.role in (UserRole.COORDINATOR, UserRole.MANAGER)


class AccessPolicy:
    @staticmethod
    def _qa_status_key(epic: Epic) -> str:
        return str(epic.qa_block.status or "").strip().lower()

    @staticmethod
    def get_allowed_project_ids(user: User) -> list[int]:
        if user.role == UserRole.ADMIN:
            return []
        return [p.id for p in user.projects]

    @staticmethod
    def has_project_access(user: User, project_id: int) -> bool:
        if user.role == UserRole.ADMIN:
            return True
        return any(p.id == project_id for p in user.projects)

    @staticmethod
    def can_view_epic(user: User, epic: Epic) -> bool:
        return AccessPolicy.has_project_access(user, epic.project_id)

    @staticmethod
    def can_manage_epic(user: User, epic: Epic) -> bool:
        if user.role == UserRole.ADMIN:
            return True
        if is_coordinator_role(user) and AccessPolicy.has_project_access(user, epic.project_id):
            return True
        return False

    @staticmethod
    def can_edit_epic(user: User, epic: Epic) -> bool:
        return AccessPolicy.can_manage_epic(user, epic)

    @staticmethod
    def can_edit_epic_links(user: User, epic: Epic) -> bool:
        return AccessPolicy.can_manage_epic(user, epic)

    @staticmethod
    def can_edit_epic_notes(user: User, epic: Epic) -> bool:
        return AccessPolicy.has_project_access(user, epic.project_id)

    @staticmethod
    def can_edit_test_plan(user: User, epic: Epic) -> bool:
        if not AccessPolicy.has_project_access(user, epic.project_id):
            return False
        return AccessPolicy._qa_status_key(epic) == EpicQAStatus.DRAFT.value

    @staticmethod
    def can_update_test_execution(user: User, epic: Epic) -> bool:
        if not AccessPolicy.has_project_access(user, epic.project_id):
            return False
        key = AccessPolicy._qa_status_key(epic)
        return key in (EpicQAStatus.IN_TESTING.value, EpicQAStatus.BLOCKED.value)

    @staticmethod
    def can_transition_qa_status(user: User, epic: Epic) -> bool:
        return AccessPolicy.can_manage_epic(user, epic)

    @staticmethod
    def can_view_release(user: User, release: Release) -> bool:
        return AccessPolicy.has_project_access(user, release.project_id)

    @staticmethod
    def can_manage_release(user: User, release: Release) -> bool:
        if user.role == UserRole.ADMIN:
            return True
        return is_coordinator_role(user) and AccessPolicy.has_project_access(user, release.project_id)

    @staticmethod
    def release_allowed_transitions(release: Release) -> list[ReleaseStatus]:
        current = release.status if isinstance(release.status, ReleaseStatus) else ReleaseStatus(str(release.status).lower())
        return {
            ReleaseStatus.DRAFT: [ReleaseStatus.IN_PROGRESS, ReleaseStatus.CANCELLED],
            ReleaseStatus.IN_PROGRESS: [ReleaseStatus.READY, ReleaseStatus.CANCELLED],
            ReleaseStatus.READY: [ReleaseStatus.IN_PROGRESS, ReleaseStatus.RELEASED, ReleaseStatus.CANCELLED],
            ReleaseStatus.RELEASED: [],
            ReleaseStatus.CANCELLED: [],
        }[current]
