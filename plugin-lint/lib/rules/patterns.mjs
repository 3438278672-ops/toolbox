// 所有检测特征集中在这里。
// 这个文件本身包含它要检测的特征（乱码标记等），发布前用 .pluginlint.json 的 waiver 显式豁免；
// 其他文件不要再各自维护一份正则，避免规则漂移。
export const PATH_PATTERNS = [
  /(?:^|[^A-Za-z0-9])([A-Za-z]:[\\/][^\s"'`)]*)/,
  /(\\\\[A-Za-z0-9._-]+\\[^\s"'`)]*)/,
  /(?:^|[\s"'(=])(\/(?:home|Users|root|opt|mnt|var|tmp)\/[^\s"'`)]*)/,
  /(file:\/\/\/[^\s"'`)]*)/,
]

export const PATH_URL_RE = /https?:\/\/[^\s"'`)]+/g
export const PATH_PLACEHOLDER_RE = /(<[^>]+>|\.\.\.|path[\\/]+to\b|\byour\b|\bexample\b|\bxxx\b|\bfoo\b)/i

export const CREDENTIAL_RE =
  /^(?:credential.*\.json|.*secret.*\.json|.*\.pem|.*\.key|id_rsa.*|\.env.*|.*\.p12|.*\.keystore)$/i
export const EXAMPLE_RE = /\.(?:example|sample)(?:\.|$)/i
export const SECRET_PLACEHOLDER_RE =
  /(<[^>]+>|\.\.\.|\byour\b|\bexample\b|\bxxx\b|\bfoo\b|\bchangeme\b|\$\{|\bprocess\.env\b|\bREDACTED\b|\bdummy\b)/i

export const SECRET_PATTERNS = [
  { label: '私钥块', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { label: 'OpenAI/DeepSeek 密钥', re: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { label: 'GitHub token', re: /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  { label: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'Bearer token', re: /\bBearer\s+([A-Za-z0-9._~+/=-]{20,})/ },
  { label: '密码明文', re: /\bpassword\s*[:=]\s*['"]?([^\s'"]{6,})/i },
]

export const MOJIBAKE_MARKERS = ['\uFFFD', '锟斤拷', 'ï¿½']
