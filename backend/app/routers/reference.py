from fastapi import APIRouter, Depends

from ..deps import get_current_user
from ..models import User
from ..reference_data import reference_payload

router = APIRouter(prefix="/reference", tags=["reference"])


@router.get("")
def get_reference_data(user: User = Depends(get_current_user)) -> dict:
    return reference_payload()
