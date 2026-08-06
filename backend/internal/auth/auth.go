// Package auth 提供 JWT 签发/校验、密码哈希与 cookie 处理。
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/pbkdf2"
)

const (
	hashIterations   = 120000
	hashKeyLength    = 32
	AUTH_COOKIE_NAME = "auth_token"
	authCookieMaxAge = int64(60 * 60 * 24 * 7) // 7 days
)

const (
	RoleAdmin    = "admin"
	RoleMember   = "member"
	StatusActive = "active"
	StatusSusp   = "suspended"
)

// Payload 即 JWT 载荷结构，与 TS 端 AuthPayload 对齐。
type Payload struct {
	UserId   string `json:"userId"`
	Username string `json:"username"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	Jti      string `json:"jti,omitempty"` // 存在表示是 API token
	Iat      int64  `json:"iat,omitempty"`
	Exp      int64  `json:"exp,omitempty"`
}

// JWTService 封装自研 HS256 base64url JWT。
type JWTService struct {
	secret []byte
}

// NewJWTService 构造 JWT 服务。
func NewJWTService(secret string) *JWTService {
	return &JWTService{secret: []byte(secret)}
}

func b64url(b []byte) string                { return base64.RawURLEncoding.EncodeToString(b) }
func b64urlDecode(s string) ([]byte, error) { return base64.RawURLEncoding.DecodeString(s) }

// Sign 生成 JWT（无过期时不写 exp 字段）。
func (j *JWTService) Sign(p Payload) (string, error) {
	header := []byte(`{"alg":"HS256","typ":"JWT"}`)
	now := time.Now().Unix()
	p.Iat = now
	if p.Exp < now {
		p.Exp = 0 // 不允许过去的过期时间
	}
	pb, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	tokenData := b64url(header) + "." + b64url(pb)
	return tokenData + "." + j.hmac(tokenData), nil
}

// SignWithSession 签发令牌；expiresIn>0 时写入过期时间，否则无过期。
func (j *JWTService) SignWithSession(p Payload, expiresIn int64) (string, error) {
	if expiresIn > 0 {
		p.Exp = time.Now().Unix() + expiresIn
	}
	return j.Sign(p)
}

func (j *JWTService) hmac(data string) string {
	mac := hmac.New(sha256.New, j.secret)
	mac.Write([]byte(data))
	return b64url(mac.Sum(nil))
}

// Verify 校验签名并解析载荷。
func (j *JWTService) Verify(token string) (*Payload, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("token 段数错误")
	}
	head, payload, sig := parts[0], parts[1], parts[2]
	expected := j.hmac(head + "." + payload)
	if subtle.ConstantTimeCompare([]byte(sig), []byte(expected)) != 1 {
		return nil, fmt.Errorf("签名校验失败")
	}
	raw, err := b64urlDecode(payload)
	if err != nil {
		return nil, err
	}
	var p Payload
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if p.Exp != 0 && p.Exp < time.Now().Unix() {
		return nil, fmt.Errorf("token 已过期")
	}
	if p.UserId == "" || p.Username == "" || p.Role == "" {
		return nil, fmt.Errorf("token 缺失必要字段")
	}
	return &p, nil
}

// ---- 密码哈希 (PBKDF2-SHA256) ----

// HashPassword 生成 `pbkdf2_sha256$iters$salt$derived`。
func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	derived := pbkdf2.Key([]byte(password), salt, hashIterations, hashKeyLength, sha256.New)
	return fmt.Sprintf("pbkdf2_sha256$%d$%s$%s", hashIterations, b64url(salt), b64url(derived)), nil
}

func legacySha256Hex(password string) string {
	sum := sha256.Sum256([]byte(password))
	return hex.EncodeToString(sum[:])
}

// VerifyPassword 校验密码，兼容新版 PBKDF2 与旧版 sha256 hex。
func VerifyPassword(password, stored string) bool {
	if strings.HasPrefix(stored, "pbkdf2_sha256$") {
		parts := strings.Split(stored, "$")
		if len(parts) != 4 {
			return false
		}
		iter, err := strconv.Atoi(parts[1])
		if err != nil || iter <= 0 {
			return false
		}
		salt, err := b64urlDecode(parts[2])
		if err != nil {
			return false
		}
		expected, err := b64urlDecode(parts[3])
		if err != nil {
			return false
		}
		actual := pbkdf2.Key([]byte(password), salt, iter, hashKeyLength, sha256.New)
		if len(actual) != len(expected) {
			return false
		}
		return subtle.ConstantTimeCompare(actual, expected) == 1
	}
	return subtle.ConstantTimeCompare([]byte(legacySha256Hex(password)), []byte(stored)) == 1
}

// IsLegacyPasswordHash 判定旧版 sha256 hex 哈希。
func IsLegacyPasswordHash(stored string) bool {
	return !strings.HasPrefix(stored, "pbkdf2_sha256$")
}

// ---- Cookie ----

// SetAuthCookie 生成 Set-Cookie 头 value。
func SetAuthCookie(token string, secure bool) string {
	v := "auth_token=" + url.QueryEscape(token) + "; Path=/; Max-Age=" +
		strconv.FormatInt(authCookieMaxAge, 10) + "; HttpOnly; SameSite=Lax"
	if secure {
		v += "; Secure"
	}
	return v
}

// ClearAuthCookie 生成清除 cookie 的 Set-Cookie value。
func ClearAuthCookie() string {
	return "auth_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"
}

// ReadAuthCookie 从 Cookie 头解析 auth_token。
func ReadAuthCookie(cookieHeader string) string {
	if cookieHeader == "" {
		return ""
	}
	for _, part := range strings.Split(cookieHeader, ";") {
		p := strings.TrimSpace(part)
		idx := strings.IndexByte(p, '=')
		if idx < 0 {
			continue
		}
		name := strings.TrimSpace(p[:idx])
		value := strings.TrimSpace(p[idx+1:])
		if name == AUTH_COOKIE_NAME && value != "" {
			if decoded, err := url.QueryUnescape(value); err == nil {
				return decoded
			}
			return value
		}
	}
	return ""
}