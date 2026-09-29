from __future__ import annotations

from fastapi import APIRouter, Response, status

from netops.api.deps import Admin, UserServiceDep
from netops.models import User
from netops.schemas.users import UserCreate, UserRead, UserUpdate, UserWithToken

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserRead], summary="List users")
def list_users(service: UserServiceDep, _: Admin) -> list[User]:
    return list(service.list_users())


@router.post(
    "",
    response_model=UserWithToken,
    status_code=status.HTTP_201_CREATED,
    summary="Create a user and issue its API token",
)
def create_user(data: UserCreate, service: UserServiceDep, _: Admin) -> UserWithToken:
    return _with_token(*service.create(data))


@router.get("/{user_id}", response_model=UserRead, summary="Get a user")
def get_user(user_id: int, service: UserServiceDep, _: Admin) -> User:
    return service.get(user_id)


@router.patch("/{user_id}", response_model=UserRead, summary="Change role or disable a user")
def update_user(user_id: int, data: UserUpdate, service: UserServiceDep, admin: Admin) -> User:
    return service.update(user_id, data, acting_user=admin.username)


@router.post(
    "/{user_id}/token",
    response_model=UserWithToken,
    summary="Issue a new token; the previous one stops working",
)
def rotate_token(user_id: int, service: UserServiceDep, _: Admin) -> UserWithToken:
    return _with_token(*service.rotate_token(user_id))


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a user")
def delete_user(user_id: int, service: UserServiceDep, admin: Admin) -> Response:
    service.delete(user_id, acting_user=admin.username)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _with_token(user: User, token: str) -> UserWithToken:
    return UserWithToken(**UserRead.model_validate(user).model_dump(), token=token)
