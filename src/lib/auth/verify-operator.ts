import bcrypt from "bcryptjs";

export interface Operator {
  email: string;
  passwordHash: string;
}

export interface OperatorUser {
  id: string;
  email: string;
}

// Pure credential check for the single operator. Returns the user on an exact
// (case-insensitive email) match with a verified bcrypt password, else null.
// Takes the operator config explicitly so it is testable without env.
export async function verifyOperator(
  input: { email?: unknown; password?: unknown },
  operator: Operator,
): Promise<OperatorUser | null> {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!email || !password) return null;

  const operatorEmail = operator.email.trim().toLowerCase();
  if (email !== operatorEmail) return null;

  const ok = await bcrypt.compare(password, operator.passwordHash);
  if (!ok) return null;

  return { id: "operator", email: operatorEmail };
}
