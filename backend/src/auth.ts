import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { config } from "./config";

export type Role = "client" | "hospital" | "provider";

export interface User {
  email: string;
  passwordHash: string;
  name: string;
  role: Role;
  wallet?: string | null;
  hospitalId?: string | null;
  createdAt: string;
}

const USERS_FILE = path.join(config.dataDir, "users.json");

function loadUsers(): Record<string, User> {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
  if (fs.existsSync(USERS_FILE)) {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  }
  // First boot: seed the initial platform accounts
  const seed: Record<string, User> = {};
  const mk = (email: string, name: string, role: Role, extra: Partial<User> = {}) => {
    seed[email] = {
      email,
      passwordHash: bcrypt.hashSync("demo1234", 10),
      name,
      role,
      wallet: null,
      hospitalId: null,
      createdAt: new Date().toISOString(),
      ...extra,
    };
  };
  mk("client@proofsure.dev", "Alex Kim", "client");
  mk("hospital@proofsure.dev", "Apollo Demo Hospital", "hospital", { hospitalId: "HOSP001" });
  mk("provider@proofsure.dev", "SureLife Mutual", "provider");
  fs.writeFileSync(USERS_FILE, JSON.stringify(seed, null, 2));
  return seed;
}

export let users = loadUsers();

function persist() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

export function signToken(u: User) {
  return jwt.sign({ email: u.email, role: u.role }, config.jwtSecret, {
    expiresIn: config.jwtTtl,
  } as jwt.SignOptions);
}

export function publicUser(u: User) {
  const { passwordHash: _ph, ...rest } = u;
  return rest;
}

// --- middleware ---

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required." });
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { email: string; role: Role };
    const user = users[payload.email];
    if (!user) return res.status(401).json({ error: "Unknown account." });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired — please log in again." });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    requireAuth(req, res, () => {
      if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ error: `This action requires role: ${roles.join(" or ")}.` });
      }
      next();
    });
  };
}

// --- routes ---

export const authRouter = Router();

authRouter.post("/register", (req, res) => {
  const { email, password, name, role, wallet } = req.body || {};
  if (!email || !password || !name || !role) {
    return res.status(400).json({ error: "email, password, name and role are required." });
  }
  if (!["client", "hospital", "provider"].includes(role)) {
    return res.status(400).json({ error: "role must be client, hospital or provider." });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  if (users[String(email).toLowerCase()]) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }
  // Hospital identity is server-assigned and unique — it binds the login to the
  // EdDSA key registry entry used for invoice signing.
  let hospitalId: string | null = null;
  if (role === "hospital") {
    const taken = new Set(Object.values(users).map((u) => u.hospitalId).filter(Boolean));
    let n = 1;
    while (taken.has(`HOSP${String(n).padStart(3, "0")}`)) n += 1;
    hospitalId = `HOSP${String(n).padStart(3, "0")}`;
  }
  const user: User = {
    email: String(email).toLowerCase(),
    passwordHash: bcrypt.hashSync(String(password), 10),
    name,
    role,
    wallet: wallet ?? null,
    hospitalId,
    createdAt: new Date().toISOString(),
  };
  users[user.email] = user;
  persist();
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

authRouter.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = users[String(email || "").toLowerCase()];
  if (!user || !bcrypt.compareSync(String(password || ""), user.passwordHash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!) });
});

authRouter.patch("/me/wallet", requireAuth, (req, res) => {
  req.user!.wallet = String(req.body?.wallet || "");
  persist();
  res.json({ user: publicUser(req.user!) });
});
