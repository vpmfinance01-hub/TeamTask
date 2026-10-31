import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Group, GroupMember, Membership, Org, Plan } from "./types";
import {
  computePerm, DEFAULT_SETTINGS, DEFAULT_VISIBILITY, mergeVisibility,
  type OrgSettings, type Perm, type Visibility,
} from "./features";

type MyMembership = Membership & { organizations: Org };

export interface GroupSettings {
  group_id: string;
  visibility: Partial<Visibility>;
}

interface Ctx {
  loading: boolean;
  session: Session | null;
  memberships: MyMembership[];
  me: Membership | null;
  org: Org | null;
  plan: Plan | null;
  plans: Plan[];
  isOwner: boolean;
  isManager: boolean; // собственик или ръководител
  members: Membership[];
  groups: Group[];
  groupMembers: GroupMember[];
  myGroupIds: string[];
  leaderGroupIds: string[];
  settings: OrgSettings; // модули на фирмата (задава работодателят)
  groupSettings: GroupSettings[]; // какво виждат служителите, по групи (задава ръководителят)
  visibility: Visibility; // ефективна видимост за текущия човек
  perm: Perm; // какво може да ползва текущият човек
  switchOrg: (orgId: string) => void;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const C = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(C);

const ORG_KEY = "teamtasks.org";

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [mineFor, setMineFor] = useState<string | null>(null); // за кой потребител са заредени фирмите му
  const [memberships, setMemberships] = useState<MyMembership[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [orgId, setOrgId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ORG_KEY);
    } catch {
      return null;
    }
  });
  const [members, setMembers] = useState<Membership[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [orgLoadedFor, setOrgLoadedFor] = useState<string | null>(null); // за коя фирма са заредени хората, групите и настройките
  const [settings, setSettings] = useState<OrgSettings>(DEFAULT_SETTINGS);
  const [groupSettings, setGroupSettings] = useState<GroupSettings[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBooting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id ?? null;

  const loadMine = useCallback(async () => {
    if (!uid) {
      setMemberships([]);
      setMineFor(null);
      return;
    }
    const [m, p] = await Promise.all([
      supabase
        .from("memberships")
        .select("*, organizations(*)")
        .eq("user_id", uid)
        .eq("active", true)
        .order("created_at"),
      supabase.from("plans").select("*").order("sort"),
    ]);
    setMemberships((m.data as unknown as MyMembership[]) ?? []);
    setPlans((p.data as Plan[]) ?? []);
    setMineFor(uid);
  }, [uid]);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  const current = useMemo(
    () => memberships.find((m) => m.org_id === orgId) ?? memberships[0] ?? null,
    [memberships, orgId],
  );
  const currentOrgId = current?.org_id ?? null;

  const loadOrgData = useCallback(async () => {
    if (!currentOrgId) {
      setMembers([]);
      setGroups([]);
      setGroupMembers([]);
      setSettings(DEFAULT_SETTINGS);
      setGroupSettings([]);
      return;
    }
    const [m, g, gm, os, gs] = await Promise.all([
      supabase.from("memberships").select("*").eq("org_id", currentOrgId).order("display_name"),
      supabase.from("groups").select("*").eq("org_id", currentOrgId).order("name"),
      supabase.from("group_members").select("group_id, membership_id, is_leader").eq("org_id", currentOrgId),
      supabase.from("org_settings").select("features, languages").eq("org_id", currentOrgId).maybeSingle(),
      supabase.from("group_settings").select("group_id, visibility").eq("org_id", currentOrgId),
    ]);
    setMembers((m.data as Membership[]) ?? []);
    setGroups((g.data as Group[]) ?? []);
    setGroupMembers((gm.data as GroupMember[]) ?? []);
    const row = os.data as Partial<OrgSettings> | null;
    setSettings(row ? { features: { ...DEFAULT_SETTINGS.features, ...row.features }, languages: row.languages?.length ? row.languages : ["bg"] } : DEFAULT_SETTINGS);
    setGroupSettings((gs.data as GroupSettings[]) ?? []);
    setOrgLoadedFor(currentOrgId);
  }, [currentOrgId]);

  useEffect(() => {
    loadOrgData();
  }, [loadOrgData]);

  const reload = useCallback(async () => {
    await loadMine();
    await loadOrgData();
  }, [loadMine, loadOrgData]);

  const me: Membership | null = current;
  const org = current?.organizations ?? null;
  const myGroupIds = useMemo(
    () => (me ? groupMembers.filter((g) => g.membership_id === me.id).map((g) => g.group_id) : []),
    [groupMembers, me],
  );
  const leaderGroupIds = useMemo(
    () => (me ? groupMembers.filter((g) => g.membership_id === me.id && g.is_leader).map((g) => g.group_id) : []),
    [groupMembers, me],
  );

  const isManagerRole = me?.role === "owner" || me?.role === "manager";
  const visibility = useMemo(() => {
    const mine = groupSettings.filter((s) => myGroupIds.includes(s.group_id)).map((s) => s.visibility);
    // група без запис в настройките получава стандартните права
    const missing = myGroupIds.filter((id) => !groupSettings.some((s) => s.group_id === id)).map(() => DEFAULT_VISIBILITY);
    return mergeVisibility([...mine, ...missing]);
  }, [groupSettings, myGroupIds]);
  const perm = useMemo(() => computePerm(isManagerRole, settings, visibility), [isManagerRole, settings, visibility]);

  const value: Ctx = {
    settings,
    groupSettings,
    visibility,
    perm,
    // докато фирмите на влезлия потребител не са заредени, не показваме нито „създай фирма“, нито менюто
    // (и докато настройките на фирмата не са заредени – иначе директен адрес към изключен/разрешен модул би пренасочвал погрешно)
    loading: booting || (uid !== null && mineFor !== uid) || (currentOrgId !== null && orgLoadedFor !== currentOrgId),
    session,
    memberships,
    me,
    org,
    plan: plans.find((p) => p.key === org?.plan_key) ?? null,
    plans,
    isOwner: me?.role === "owner",
    isManager: me?.role === "owner" || me?.role === "manager",
    members,
    groups,
    groupMembers,
    myGroupIds,
    leaderGroupIds,
    switchOrg: (id) => {
      try {
        localStorage.setItem(ORG_KEY, id);
      } catch {
        /* private mode */
      }
      setOrgId(id);
    },
    reload,
    signOut: async () => {
      await supabase.auth.signOut();
      setMemberships([]);
    },
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}
