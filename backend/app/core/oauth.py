"""OAuth 2.0 / OpenID Connect clients for the sign-in providers, for a backend-driven authorization code
flow: the client secret never reaches the browser."""

from authlib.integrations.starlette_client import OAuth

from app.core.config import Settings, settings

oauth = OAuth()


def register_clients(config: Settings) -> None:
    """Registers every provider that has credentials. One without a client id is never registered."""
    if config.OIDC_CLIENT_ID and config.OIDC_AUTHORITY:
        oauth.register(
            name="oidc",
            client_id=config.OIDC_CLIENT_ID,
            client_secret=config.OIDC_CLIENT_SECRET,
            server_metadata_url=f"{config.OIDC_AUTHORITY.rstrip('/')}/.well-known/openid-configuration",
            client_kwargs={"scope": "openid profile email"},
        )
    if config.YANDEX_CLIENT_ID:
        # Yandex ID is plain OAuth 2.0 without discovery; the profile comes from login.yandex.ru/info.
        oauth.register(
            name="yandex",
            client_id=config.YANDEX_CLIENT_ID,
            client_secret=config.YANDEX_CLIENT_SECRET,
            authorize_url="https://oauth.yandex.ru/authorize",
            access_token_url="https://oauth.yandex.ru/token",
            api_base_url="https://login.yandex.ru/",
            client_kwargs={"scope": "login:info login:email"},
        )
    if config.GOOGLE_CLIENT_ID:
        oauth.register(
            name="google",
            client_id=config.GOOGLE_CLIENT_ID,
            client_secret=config.GOOGLE_CLIENT_SECRET,
            server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
            client_kwargs={"scope": "openid email profile"},
        )


register_clients(settings)
