/** Mirrors backend validate_password: 8+ characters and at least 3 of 4 character classes. */
export type PasswordCheck = {
  longEnough: boolean;
  classes: number;
  hasUpper: boolean;
  hasLower: boolean;
  hasDigit: boolean;
  hasSymbol: boolean;
  /** Accepted by the server. */
  valid: boolean;
  /** 0 empty · 1 weak · 2 fair · 3 good · 4 strong. Display only. */
  score: 0 | 1 | 2 | 3 | 4;
  label: "" | "Too short" | "Weak" | "Fair" | "Good" | "Strong";
};

export function checkPassword(pw: string): PasswordCheck {
  const hasUpper = /[A-Z]/.test(pw);
  const hasLower = /[a-z]/.test(pw);
  const hasDigit = /\d/.test(pw);
  const hasSymbol = /[!@#$%^&*(),.?":{}|<>_\-+=[\]\;/'`~]/.test(pw);
  const classes = [hasUpper, hasLower, hasDigit, hasSymbol].filter(Boolean).length;
  const longEnough = pw.length >= 8;
  const valid = longEnough && classes >= 3;
  let score: PasswordCheck["score"] = 0;
  if (pw.length > 0) {
    if (!valid) score = 1;
    else if (pw.length >= 14 && classes === 4) score = 4;
    else if (pw.length >= 12 || classes === 4) score = 3;
    else score = 2;
  }
  const label: PasswordCheck["label"] =
    pw.length === 0 ? "" : !longEnough ? "Too short" : score === 1 ? "Weak" : score === 2 ? "Fair" : score === 3 ? "Good" : "Strong";
  return { longEnough, classes, hasUpper, hasLower, hasDigit, hasSymbol, valid, score, label };
}
