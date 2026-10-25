import uuid
from typing import Annotated, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from app.models import CategoryKind

Name = Annotated[str, Field(min_length=1, max_length=50)]
# lucide-react component name, e.g. "UtensilsCrossed" (the frontend checks it really exists).
Icon = Annotated[str, Field(pattern=r"^[A-Z][A-Za-z0-9]{1,49}$")]
Color = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$"), AfterValidator(str.lower)]


class _Input(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class CategoryCreate(_Input):
    name: Name
    icon: Icon = "Tag"
    color: Color = "#64748b"
    kind: CategoryKind = CategoryKind.EXPENSE


class CategoryUpdate(_Input):
    name: Name | None = None
    icon: Icon | None = None
    color: Color | None = None
    kind: CategoryKind | None = None

    @model_validator(mode="after")
    def _not_null(self) -> Self:
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class CategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    icon: str
    color: str
    kind: CategoryKind
    is_system: bool
    is_archived: bool
    sort_order: int


class CategoryList(BaseModel):
    items: list[CategoryRead]
