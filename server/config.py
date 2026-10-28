"""从环境变量读取配置。所有密钥只在服务端，绝不返回给前端。"""
import os


class ConfigError(Exception):
    """配置值不合法。"""


def _int(env, name, default, minimum=None, maximum=None):
    raw = (env.get(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ConfigError(f"{name} 必须是整数，当前值不是整数。") from None
    if minimum is not None and value < minimum:
        raise ConfigError(f"{name} 不能小于 {minimum}。")
    if maximum is not None and value > maximum:
        raise ConfigError(f"{name} 不能大于 {maximum}。")
    return value


class Config:
    def __init__(self, environ=None):
        env = os.environ if environ is None else environ

        self.port = _int(env, "PORT", 8787, 0, 65535)
        self.ai_api_base = (env.get("AI_API_BASE") or "https://api.deepseek.com/v1").strip().rstrip("/")
        self.ai_api_key = (env.get("AI_API_KEY") or "").strip()
        self.ai_model = (env.get("AI_MODEL") or "deepseek-chat").strip()
        self.ai_timeout = _int(env, "AI_TIMEOUT_SECONDS", 120, 10, 600)

        raw_origins = env.get("ALLOWED_ORIGINS") or "https://verity077.github.io"
        self.allowed_origins = [item.strip().rstrip("/") for item in raw_origins.split(",") if item.strip()]

        self.max_files = _int(env, "MAX_FILES", 5, 1, 20)
        self.max_file_mb = _int(env, "MAX_FILE_MB", 20, 1, 100)
        self.max_total_mb = _int(env, "MAX_TOTAL_MB", 40, 1, 200)
        self.max_chars = _int(env, "MAX_EXTRACTED_CHARS", 120000, 1000, 500000)
        self.rate_limit_per_hour = _int(env, "RATE_LIMIT_PER_HOUR", 20, 1, 1000)
        self.max_concurrent = _int(env, "MAX_CONCURRENT_JOBS", 2, 1, 10)

        # 仅本地联调使用；生产环境必须保持 0。
        self.mock = (env.get("AI_MOCK") or "").strip() == "1"

    @property
    def max_file_bytes(self):
        return self.max_file_mb * 1024 * 1024

    @property
    def max_total_bytes(self):
        return self.max_total_mb * 1024 * 1024

    def public_summary(self):
        """可安全输出的配置摘要，不含密钥。"""
        return {
            "model": self.ai_model,
            "api_base": self.ai_api_base,
            "configured": bool(self.ai_api_key) or self.mock,
            "mock": self.mock,
            "allowed_origins": self.allowed_origins,
            "max_files": self.max_files,
            "max_file_mb": self.max_file_mb,
            "max_total_mb": self.max_total_mb,
        }
