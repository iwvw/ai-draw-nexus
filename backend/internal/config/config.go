package config

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strconv"
)

// Config 保存服务运行所需的全部配置。
// 优先从环境变量读取，缺失时使用合理默认值。
type Config struct {
	Port           string
	DBPath         string
	JWTSecret      string
	NodeEnv        string
	DevSecretFile  string
	DistDir        string
	AIProvider     string
	AIBaseURL      string
	AIAPIKey       string
	AIModelID      string
	AccessPassword string
	DailyQuota     int
	DisableRegistr bool
	PublicBaseURL  string
}

// Load 从环境变量组装 Config，并解析 JWT 密钥。
// 生产环境必须显式提供 JWT_SECRET，否则返回错误。
func Load() (*Config, error) {
	cfg := &Config{
		Port:           envOrDefault("PORT", "8787"),
		DBPath:         envOrDefault("DATABASE_PATH", "data/nexus.db"),
		NodeEnv:        os.Getenv("NODE_ENV"),
		DistDir:        envOrDefault("DIST_DIR", "./dist"),
		AIProvider:     envOrDefault("AI_PROVIDER", "openai"),
		AIBaseURL:      envOrDefault("AI_BASE_URL", "https://api.openai.com/v1"),
		AIAPIKey:       os.Getenv("AI_API_KEY"),
		AIModelID:      envOrDefault("AI_MODEL_ID", "gpt-4o-mini"),
		AccessPassword: os.Getenv("ACCESS_PASSWORD"),
		DailyQuota:     envInt("DAILY_QUOTA", 10),
		PublicBaseURL:  os.Getenv("PUBLIC_BASE_URL"),
	}
	cfg.DisableRegistr = os.Getenv("DISABLE_REGISTRATION") == "true"
	cfg.DevSecretFile = os.Getenv("JWT_SECRET_FILE")
	if cfg.DevSecretFile == "" {
		cfg.DevSecretFile = filepath.Join(workDir(), ".dev.secret")
	}

	secret, err := resolveJWTSecret(cfg)
	if err != nil {
		return nil, err
	}
	cfg.JWTSecret = secret
	return cfg, nil
}

// IsProduction 判断是否生产环境。
func (c *Config) IsProduction() bool { return c.NodeEnv == "production" }

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func workDir() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}

// resolveJWTSecret 复用 TS 端 getJwtSecret 的逻辑：
// 1. JWT_SECRET 优先；2. 生产环境缺失直接报错；
// 3. 读 .dev.secret 文件；4. 都没有则生成并持久化。
func resolveJWTSecret(cfg *Config) (string, error) {
	if v := os.Getenv("JWT_SECRET"); v != "" {
		return v, nil
	}
	if cfg.NodeEnv == "production" {
		return "", errors.New("生产环境必须设置 JWT_SECRET")
	}
	if data, err := os.ReadFile(cfg.DevSecretFile); err == nil {
		if s := trimSpace(string(data)); s != "" {
			return s, nil
		}
	}
	secret := randomHex(32)
	if err := os.WriteFile(cfg.DevSecretFile, []byte(secret), 0o600); err != nil {
		// 非致命：本地开发每次重启会重新生成
		return secret, nil
	}
	return secret, nil
}

func trimSpace(s string) string {
	for len(s) > 0 && (s[len(s)-1] == '\n' || s[len(s)-1] == '\r' || s[len(s)-1] == ' ' || s[len(s)-1] == '\t') {
		s = s[:len(s)-1]
	}
	return s
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}