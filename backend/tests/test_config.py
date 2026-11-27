"""Start-up checks of the settings."""

import pytest

from app.core.config import DEV_SESSION_SECRET_KEY, Settings

SECRET = "s" * 40


def settings_for(**values) -> Settings:
    """A complete, valid production configuration with `values` applied on top."""
    config = {
        "APP_ENV": "production",
        "DATABASE_URL": "postgresql+asyncpg://horizon:secret@db:5432/horizon",
        "BASE_URL": "https://horizon.example",
        "SESSION_SECRET_KEY": SECRET,
        "SESSION_COOKIE_SECURE": True,
        "OIDC_CLIENT_ID": "id",
        "OIDC_CLIENT_SECRET": "secret",
        "OIDC_AUTHORITY": "https://idp.example",
        "YANDEX_CLIENT_ID": "",
        "GOOGLE_CLIENT_ID": "",
    }
    config.update(values)
    return Settings(_env_file=None, **config)


def test_a_complete_production_configuration_passes():
    settings = settings_for()

    assert settings.production_problems() == []
    settings.check_startup()


@pytest.mark.parametrize(
    "values, complaint",
    [
        ({"SESSION_SECRET_KEY": ""}, "SESSION_SECRET_KEY"),
        ({"SESSION_SECRET_KEY": DEV_SESSION_SECRET_KEY}, "SESSION_SECRET_KEY"),
        ({"SESSION_SECRET_KEY": "too-short"}, "SESSION_SECRET_KEY"),
        ({"BASE_URL": "http://horizon.example"}, "https://"),
        ({"SESSION_COOKIE_SECURE": False}, "SESSION_COOKIE_SECURE"),
        ({"ENABLE_TEST_LOGIN": True}, "ENABLE_TEST_LOGIN"),
        ({"DATABASE_URL": Settings.model_fields["DATABASE_URL"].default}, "DATABASE_URL"),
        ({"OIDC_CLIENT_ID": ""}, "No sign-in provider"),
        ({"OIDC_CLIENT_ID": "", "YANDEX_CLIENT_ID": "yandex"}, None),
        ({"OIDC_CLIENT_ID": "", "GOOGLE_CLIENT_ID": "google"}, None),
        ({"OIDC_CLIENT_ID": "", "OIDC_AUTHORITY": ""}, "No sign-in provider"),
    ],
)
def test_production_names_what_is_unsafe(values, complaint):
    problems = " ".join(settings_for(**values).production_problems())

    if complaint is None:
        assert settings_for(**values).production_problems() == []
    else:
        assert complaint in problems


def test_a_misconfigured_production_deployment_does_not_start():
    with pytest.raises(RuntimeError, match="BASE_URL must be an https"):
        settings_for(BASE_URL="http://horizon.example").check_startup()


def test_development_starts_without_a_session_key():
    settings = settings_for(APP_ENV="development", SESSION_SECRET_KEY="")

    settings.check_startup()
    assert settings.session_secret_key == DEV_SESSION_SECRET_KEY


def test_callback_urls_are_built_on_the_public_origin():
    settings = settings_for(BASE_URL="https://horizon.example/")

    assert settings.callback_url("/auth/signin-yandex") == "https://horizon.example/auth/signin-yandex"
    assert settings.callback_url("") == "https://horizon.example"


def test_the_environment_decides_what_production_means():
    assert settings_for(APP_ENV=" Production ").is_production
    assert not settings_for(APP_ENV="test").is_production
