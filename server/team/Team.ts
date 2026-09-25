import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { PERMISSIONS, type Permission, type TeamMember, type TeamRole } from "../../shared/types";
import type { Repository } from "../persistence/Repository";

/*
 * Agency team of one space. The founder (the space's own access code) adds members —
 * directors, managers, moderators — each with their own access code, a set of
 * permissions and optionally a limited list of streamers.
 *
 * Codes are shown once and stored only as SHA-256 hashes. A member's session cookie is
 * signed with the server secret over (space, member, code hash): regenerating the code
 * or removing the member logs that person out.
 */

const SECRET_ID = "team";
const MAX_MEMBERS = 100;

interface StoredMember extends TeamMember {
  codeHash: string;
}

export class TeamError extends Error {
  constructor(
    public code: "forbidden" | "member_not_found" | "team_full" | "invalid_input",
    public status: number,
  ) {
    super(code);
  }
}

/** Who is making a request inside a space. */
export type Principal =
  | { kind: "founder"; spaceId: string }
  | { kind: "member"; spaceId: string; member: TeamMember };

export const hashCode = (code: string) => createHash("sha256").update(code.trim()).digest("hex");

const newCode = () => {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let s = "";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `team-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
};

const eq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export class TeamStore {
  private members: StoredMember[] = [];

  constructor(
    readonly spaceId: string,
    private repo: Pick<Repository, "loadSecret" | "saveSecret">,
    private sessionSecret: string,
  ) {}

  async init(): Promise<void> {
    const stored = (await this.repo.loadSecret(SECRET_ID)) as { members?: StoredMember[] } | null;
    this.members = Array.isArray(stored?.members) ? stored.members : [];
  }

  private async save(): Promise<void> {
    await this.repo.saveSecret(SECRET_ID, { members: this.members });
  }

  /** Public view (never the code hash). */
  list(): TeamMember[] {
    return this.members.map(publicMember);
  }

  get(id: string): TeamMember | undefined {
    const m = this.members.find((x) => x.id === id);
    return m ? publicMember(m) : undefined;
  }

  /** Member whose access code this is (constant-time compare on hashes). */
  findByCode(code: string): TeamMember | undefined {
    const h = hashCode(code);
    let found: StoredMember | undefined;
    for (const m of this.members) if (eq(h, m.codeHash)) found = m;
    return found && !found.disabled ? publicMember(found) : undefined;
  }

  // ---------------------------------------------------------------- sessions

  cookieFor(member: TeamMember): string {
    const m = this.members.find((x) => x.id === member.id)!;
    return `m.${this.spaceId}.${m.id}.${this.sign(m)}`;
  }

  /** Member behind a session cookie value, if valid and still active. */
  memberFromCookie(value: string): TeamMember | undefined {
    const [tag, space, id, sig] = value.split(".");
    if (tag !== "m" || space !== this.spaceId || !id || !sig) return undefined;
    const m = this.members.find((x) => x.id === id);
    if (!m || m.disabled) return undefined;
    return eq(sig, this.sign(m)) ? publicMember(m) : undefined;
  }

  private sign(m: StoredMember): string {
    return createHmac("sha256", this.sessionSecret).update(`novus-team-v1:${this.spaceId}:${m.id}:${m.codeHash}`).digest("base64url");
  }

  // ---------------------------------------------------------------- management

  /**
   * Add a member. A delegating member can only hand out permissions and streamers they
   * have themselves. Returns the access code (shown once).
   */
  async create(by: Principal, input: MemberInput): Promise<{ member: TeamMember; code: string }> {
    this.assertCanGrant(by, input);
    if (this.members.length >= MAX_MEMBERS) throw new TeamError("team_full", 409);
    const code = newCode();
    const m: StoredMember = {
      id: randomUUID().slice(0, 12),
      name: input.name,
      role: input.role,
      permissions: normalizePermissions(input.permissions),
      accounts: normalizeAccounts(input.accounts),
      disabled: false,
      createdAt: Date.now(),
      createdBy: by.kind === "founder" ? "founder" : by.member.id,
      codeHash: hashCode(code),
    };
    this.members.push(m);
    await this.save();
    return { member: publicMember(m), code };
  }

  async update(by: Principal, id: string, patch: Partial<MemberInput> & { disabled?: boolean }): Promise<TeamMember> {
    const m = this.members.find((x) => x.id === id);
    if (!m) throw new TeamError("member_not_found", 404);
    this.assertCanManage(by, m);
    const next = {
      name: patch.name ?? m.name,
      role: patch.role ?? m.role,
      permissions: patch.permissions ?? m.permissions,
      accounts: patch.accounts !== undefined ? patch.accounts : m.accounts,
    };
    this.assertCanGrant(by, next);
    Object.assign(m, {
      ...next,
      permissions: normalizePermissions(next.permissions),
      accounts: normalizeAccounts(next.accounts),
      disabled: patch.disabled ?? m.disabled,
    });
    await this.save();
    return publicMember(m);
  }

  async regenerate(by: Principal, id: string): Promise<{ member: TeamMember; code: string }> {
    const m = this.members.find((x) => x.id === id);
    if (!m) throw new TeamError("member_not_found", 404);
    this.assertCanManage(by, m);
    const code = newCode();
    m.codeHash = hashCode(code);
    await this.save();
    return { member: publicMember(m), code };
  }

  async remove(by: Principal, id: string): Promise<void> {
    const m = this.members.find((x) => x.id === id);
    if (!m) throw new TeamError("member_not_found", 404);
    this.assertCanManage(by, m);
    this.members = this.members.filter((x) => x.id !== id);
    await this.save();
  }

  /** Only the founder, or a member with "team" who covers everything the target has. */
  private assertCanManage(by: Principal, target: StoredMember): void {
    if (by.kind === "founder") return;
    if (by.member.id === target.id) throw new TeamError("forbidden", 403);
    this.assertCanGrant(by, target);
  }

  private assertCanGrant(by: Principal, input: { permissions: Permission[]; accounts: string[] | null }): void {
    if (by.kind === "founder") return;
    const me = by.member;
    if (!me.permissions.includes("team")) throw new TeamError("forbidden", 403);
    if (input.permissions.some((p) => !me.permissions.includes(p))) throw new TeamError("forbidden", 403);
    if (me.accounts) {
      // A member limited to some streamers can only hand out (a subset of) those.
      if (!input.accounts || input.accounts.some((a) => !me.accounts!.includes(a.toLowerCase()))) throw new TeamError("forbidden", 403);
    }
  }
}

export interface MemberInput {
  name: string;
  role: TeamRole;
  permissions: Permission[];
  /** Streamers this member can see (lowercase handles); null = all. */
  accounts: string[] | null;
}

const normalizePermissions = (list: Permission[]) => PERMISSIONS.filter((p) => list.includes(p));
const normalizeAccounts = (list: string[] | null) => (list ? [...new Set(list.map((a) => a.replace(/^@/, "").toLowerCase()))] : null);

function publicMember(m: StoredMember): TeamMember {
  return { id: m.id, name: m.name, role: m.role, permissions: [...m.permissions], accounts: m.accounts ? [...m.accounts] : null, disabled: m.disabled, createdAt: m.createdAt, createdBy: m.createdBy };
}

/** What a principal may do. */
export function can(p: Principal, perm: Permission): boolean {
  return p.kind === "founder" || p.member.permissions.includes(perm);
}

/** Whether a principal may see a followed account (null scope = every account). */
export function canSeeAccount(p: Principal, username: string | undefined): boolean {
  if (p.kind === "founder" || !p.member.accounts || !username) return true;
  return p.member.accounts.includes(username.toLowerCase());
}
