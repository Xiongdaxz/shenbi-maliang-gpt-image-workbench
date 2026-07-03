import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Archive,
  Bot,
  Bug,
  Check,
  Database,
  Download,
  FolderOpen,
  ImageIcon,
  KeyRound,
  Lightbulb,
  LoaderCircle,
  LogOut,
  Mail,
  Network,
  PanelLeft,
  Pencil,
  ScrollText,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  Upload,
  Users,
  WandSparkles
} from "lucide-react";
import { api, configApi } from "../../api";
import { LightweightLineChart } from "../../components/LightweightChart";
import { MarkdownView } from "../../components/MarkdownView";
import { useInfinitePageLoader } from "../../hooks/useInfinitePageLoader";
import { DEFAULT_SITE_NAME } from "../../lib/branding";
import { copyTextToClipboard } from "../../lib/clipboard";
import { cx } from "../../lib/cx";
import { formatImageFileSize } from "../../lib/format";
import type {
  BackupRun,
  BackupSettings,
  ChangelogEntry,
  BrandingAsset,
  BrandingAssetType,
  BrandingSettings,
  ConfigStatistics,
  DebugSettings,
  ImageAccount,
  ImageAccountImportPreviewItem,
  ImageAccountImportSource,
  ImageGenerationMode,
  GlobalSwitchType,
  ModelRequestLog,
  PromptOptimizerProvider,
  ProviderConfig,
  ProviderRequestLog,
  ProxyConfig,
  SafetyReviewLog,
  SafetyReviewSettings,
  SmsSettings,
  StatisticsPreset,
  SmtpSettings,
  StarterCopySettings,
  StarterDailyCopy,
  Team
} from "../../types";
import type { ConfigAssetReviewItem, ConfigCaseReviewItem } from "../../api/config";
import { ConfirmDialog, CustomSelect, PromptDialog, useToast } from "../../ui";
import { useConfigCopy } from "../configCopy";
import {
  ConfigHeader,
  REQUEST_LOG_PAGE_SIZE,
  SwitchControl,
  durationLabel,
  emptyProvider,
  formatDate,
  inputDateOffset,
  inputDateValue,
  nextChangelogVersion,
  numberLabel,
  percentLabel,
  providerDateFromId,
  shouldAutoRefreshAccountUsage,
  todayInputDate,
  uniqueProviderFormId,
  isGeneratedProviderId,
  isGeneratedProviderName
} from "../shared";

type ConfigUser = {
  id: string;
  teamId: string;
  teamName: string;
  account: string;
  username: string;
  email: string;
  phone: string;
  disabled: boolean;
  hasConfigAccess: boolean;
  lastLoginAt: string;
  createdAt: string;
  updatedAt: string;
  sessionCount: number;
  imageCount: number;
};

type ConfigUserPayload = {
  account: string;
  username: string;
  email: string;
  phone: string;
  password?: string;
  teamId: string;
  disabled: boolean;
  hasConfigAccess: boolean;
};

type UserSwitchConfirm = {
  kind: "status" | "configAccess";
  user: ConfigUser;
};

function userSwitchConfirmCopy(confirm: UserSwitchConfirm | null) {
  if (!confirm) return { title: "", description: "", confirmText: "确认", destructive: false };
  const account = confirm.user.account || confirm.user.username;
  if (confirm.kind === "status") {
    const nextEnabled = confirm.user.disabled;
    return {
      title: nextEnabled ? "启用账号" : "禁用账号",
      description: nextEnabled
        ? `确认启用账号「${account}」？启用后该成员可以继续登录和使用系统。`
        : `确认禁用账号「${account}」？禁用后该成员将无法继续登录和使用系统。`,
      confirmText: nextEnabled ? "启用" : "禁用",
      destructive: !nextEnabled
    };
  }
  const nextAllowed = !confirm.user.hasConfigAccess;
  return {
    title: nextAllowed ? "开启管理权限" : "关闭管理权限",
    description: nextAllowed
      ? `确认给账号「${account}」开启管理权限？开启后该成员可以从头像菜单进入管理后台。`
      : `确认关闭账号「${account}」的管理权限？关闭后该成员将不能从头像菜单进入管理后台。`,
    confirmText: nextAllowed ? "开启" : "关闭",
    destructive: !nextAllowed
  };
}

export function TeamAccountPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const configCopy = useConfigCopy();
  const teams = useQuery({ queryKey: ["config-teams"], queryFn: configApi.teams });
  const [selectedTeamId, setSelectedTeamId] = useState("all");
  const [teamDialog, setTeamDialog] = useState<{ mode: "create" | "edit"; team?: Team } | null>(null);
  const [userDialog, setUserDialog] = useState<{
    mode: "create" | "edit";
    user?: ConfigUser;
    teamId?: string;
  } | null>(null);
  const [resetUser, setResetUser] = useState<ConfigUser | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    | { kind: "team"; team: Team }
    | { kind: "user"; user: ConfigUser }
    | null
  >(null);
  const [switchConfirm, setSwitchConfirm] = useState<UserSwitchConfirm | null>(null);
  const switchConfirmCopy = userSwitchConfirmCopy(switchConfirm);
  const allUserCount = useMemo(
    () => teams.data?.teams.reduce((sum, team) => sum + team.userCount, 0) ?? 0,
    [teams.data?.teams]
  );
  const selectedTeam =
    selectedTeamId === "all" ? null : teams.data?.teams.find((team) => team.id === selectedTeamId) ?? null;
  const teamUsers = useQuery({
    queryKey: ["config-users", { teamId: selectedTeam?.id ?? "all" }],
    queryFn: () => configApi.users(selectedTeam?.id ? { teamId: selectedTeam.id } : undefined),
    enabled: Boolean(teams.data)
  });
  const createTeam = useMutation({
    mutationFn: (payload: { name: string; description: string }) => configApi.createTeam(payload),
    onSuccess: () => {
      setTeamDialog(null);
      showToast("团队已新增");
      queryClient.invalidateQueries({ queryKey: ["config-teams"] });
    }
  });
  const updateTeam = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { name: string; description: string } }) =>
      configApi.updateTeam(id, payload),
    onSuccess: () => {
      setTeamDialog(null);
      showToast("团队已保存");
      queryClient.invalidateQueries({ queryKey: ["config-teams"] });
    }
  });
  const deleteTeam = useMutation({
    mutationFn: (id: string) => configApi.deleteTeam(id),
    onSuccess: () => {
      showToast("团队已删除");
      setSelectedTeamId("");
      setConfirmAction(null);
      queryClient.invalidateQueries({ queryKey: ["config-teams"] });
    }
  });
  const createUser = useMutation({
    mutationFn: (payload: ConfigUserPayload & { password: string }) => configApi.createUser(payload),
    onSuccess: () => {
      setUserDialog(null);
      showToast("账号已新增");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
      queryClient.invalidateQueries({ queryKey: ["config-teams"] });
    }
  });
  const updateUser = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ConfigUserPayload }) =>
      configApi.updateUser(id, payload),
    onSuccess: () => {
      setUserDialog(null);
      showToast("账号已保存");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
      queryClient.invalidateQueries({ queryKey: ["config-teams"] });
    }
  });
  const toggleUser = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) => configApi.updateUser(id, { disabled }),
    onSuccess: () => {
      showToast("账号状态已更新");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
    }
  });
  const toggleConfigAccess = useMutation({
    mutationFn: ({ id, hasConfigAccess }: { id: string; hasConfigAccess: boolean }) =>
      configApi.updateUser(id, { hasConfigAccess }),
    onSuccess: () => {
      showToast("管理权限已更新");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
    }
  });
  const resetPassword = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => configApi.resetPassword(id, password),
    onSuccess: () => {
      setResetUser(null);
      showToast("密码已重置");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
    }
  });
  const deleteUser = useMutation({
    mutationFn: (id: string) => configApi.deleteUser(id),
    onSuccess: () => {
      showToast("账号已删除");
      setConfirmAction(null);
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
      queryClient.invalidateQueries({ queryKey: ["config-teams"] });
    }
  });

  useEffect(() => {
    if (!selectedTeamId) setSelectedTeamId("all");
  }, [selectedTeamId, teams.data?.teams]);

  return (
    <section className="config-card">
      <ConfigHeader title="团队管理" desc="左侧按团队筛选账号，右侧维护账号与团队信息。" />
      <div className="team-manager">
        <aside className="team-tree">
          <button className="secondary-btn full" onClick={() => setTeamDialog({ mode: "create" })}>
            新增团队
          </button>
          <div className="team-tree-list">
            <button
              type="button"
              className={selectedTeamId === "all" ? "team-option active" : "team-option"}
              onClick={() => setSelectedTeamId("all")}
            >
              <span className="team-option-name">全部分组</span>
              <span className="team-option-count">{allUserCount}</span>
            </button>
            {teams.data?.teams.map((team) => (
              <button
                key={team.id}
                type="button"
                className={selectedTeam?.id === team.id ? "team-option editable active" : "team-option editable"}
                onClick={() => setSelectedTeamId(team.id)}
              >
                <span className="team-option-name">{team.name}</span>
                <span className="team-option-count">{team.userCount}</span>
                <span
                  className="team-option-edit"
                  role="button"
                  tabIndex={0}
                  aria-label={`编辑团队 ${team.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setTeamDialog({ mode: "edit", team });
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    setTeamDialog({ mode: "edit", team });
                  }}
                >
                  <Pencil size={14} />
                </span>
              </button>
            ))}
          </div>
        </aside>
        <section className="team-detail">
          <div className="team-detail-head">
            <div>
              <h3>{selectedTeam?.name ?? "全部分组"}</h3>
              <p>
                {selectedTeam
                  ? selectedTeam.description || "暂无说明"
                  : `${teams.data?.teams.length ?? 0} ${configCopy("个团队")}，${allUserCount} ${configCopy("个账号")}`}
              </p>
            </div>
            {teams.data?.teams.length ? (
              <div className="row-actions">
                <button
                  className="secondary-btn"
                  onClick={() => setUserDialog({ mode: "create", teamId: selectedTeam?.id ?? teams.data?.teams[0]?.id })}
                >
                  新增账号
                </button>
                {selectedTeam ? (
                  <button
                    className="danger-btn"
                    onClick={() => setConfirmAction({ kind: "team", team: selectedTeam })}
                  >
                    删除团队
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <UserTable
            users={teamUsers.data?.users ?? []}
            onEdit={(user) => setUserDialog({ mode: "edit", user })}
            onToggle={(user) => setSwitchConfirm({ kind: "status", user })}
            onConfigAccessToggle={(user) => setSwitchConfirm({ kind: "configAccess", user })}
            onReset={(user) => setResetUser(user)}
            onDelete={(user) => setConfirmAction({ kind: "user", user })}
          />
        </section>
      </div>
      {teamDialog ? (
        <TeamDialog
          mode={teamDialog.mode}
          team={teamDialog.team}
          onClose={() => setTeamDialog(null)}
          onSubmit={(payload) => {
            if (teamDialog.mode === "create") createTeam.mutate(payload);
            else updateTeam.mutate({ id: teamDialog.team!.id, payload });
          }}
        />
      ) : null}
      {userDialog ? (
        <UserDialog
          mode={userDialog.mode}
          user={userDialog.user}
          teams={teams.data?.teams ?? []}
          defaultTeamId={userDialog.teamId ?? selectedTeam?.id}
          onClose={() => setUserDialog(null)}
          onSubmit={(payload) => {
            if (userDialog.mode === "create") {
              createUser.mutate(payload as ConfigUserPayload & { password: string });
            } else {
              updateUser.mutate({
                id: userDialog.user!.id,
                payload: {
                  account: payload.account,
                  username: payload.username,
                  email: payload.email,
                  phone: payload.phone,
                  teamId: payload.teamId,
                  disabled: payload.disabled,
                  hasConfigAccess: payload.hasConfigAccess
                }
              });
            }
          }}
        />
      ) : null}
      <PromptDialog
        open={Boolean(resetUser)}
        title="重置密码"
        label="新密码"
        type="password"
        description={resetUser ? `为账号「${resetUser.account}」设置新密码。` : undefined}
        confirmText="重置密码"
        onCancel={() => setResetUser(null)}
        onSubmit={(password) => {
          if (resetUser) resetPassword.mutate({ id: resetUser.id, password });
        }}
      />
      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction?.kind === "team" ? "删除团队" : "删除账号"}
        description={
          confirmAction?.kind === "team"
            ? `确认删除团队「${confirmAction.team.name}」？团队下有账号时不能删除。`
            : confirmAction?.kind === "user"
              ? `确认删除账号「${confirmAction.user.account}」？该账号的对话、图片和素材记录会一起删除。`
              : ""
        }
        confirmText="删除"
        destructive
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction?.kind === "team") deleteTeam.mutate(confirmAction.team.id);
          if (confirmAction?.kind === "user") deleteUser.mutate(confirmAction.user.id);
        }}
      />
      <ConfirmDialog
        open={Boolean(switchConfirm)}
        title={switchConfirmCopy.title}
        description={switchConfirmCopy.description}
        confirmText={switchConfirmCopy.confirmText}
        destructive={switchConfirmCopy.destructive}
        onCancel={() => setSwitchConfirm(null)}
        onConfirm={() => {
          if (!switchConfirm) return;
          if (switchConfirm.kind === "status") {
            toggleUser.mutate({ id: switchConfirm.user.id, disabled: !switchConfirm.user.disabled });
          } else {
            toggleConfigAccess.mutate({
              id: switchConfirm.user.id,
              hasConfigAccess: !switchConfirm.user.hasConfigAccess
            });
          }
          setSwitchConfirm(null);
        }}
      />
    </section>
  );
}

export function AccountSearchPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [keyword, setKeyword] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [userDialog, setUserDialog] = useState<{ mode: "create" | "edit"; user?: ConfigUser } | null>(null);
  const [resetUser, setResetUser] = useState<ConfigUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConfigUser | null>(null);
  const [switchConfirm, setSwitchConfirm] = useState<UserSwitchConfirm | null>(null);
  const switchConfirmCopy = userSwitchConfirmCopy(switchConfirm);
  const registrationSettings = useQuery({
    queryKey: ["config-registration-settings"],
    queryFn: configApi.registrationSettings
  });
  const registrationEnabled = registrationSettings.data?.settings.enabled ?? false;
  const teams = useQuery({ queryKey: ["config-teams"], queryFn: configApi.teams });
  const users = useQuery({
    queryKey: ["config-users", { keyword, teamFilter, statusFilter }],
    queryFn: () => configApi.users({ keyword, teamId: teamFilter, status: statusFilter })
  });
  const saveRegistrationSettings = useMutation({
    mutationFn: (enabled: boolean) => configApi.saveRegistrationSettings({ enabled }),
    onSuccess: (data) => {
      showToast(data.settings.enabled ? "自助注册已开启" : "自助注册已关闭");
      queryClient.invalidateQueries({ queryKey: ["config-registration-settings"] });
    }
  });
  const createUser = useMutation({
    mutationFn: (payload: ConfigUserPayload & { password: string }) => configApi.createUser(payload),
    onSuccess: () => {
      setUserDialog(null);
      showToast("账号已新增");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
      queryClient.invalidateQueries({ queryKey: ["config-teams"] });
    }
  });
  const updateUser = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ConfigUserPayload }) =>
      configApi.updateUser(id, payload),
    onSuccess: () => {
      setUserDialog(null);
      showToast("账号已保存");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
      queryClient.invalidateQueries({ queryKey: ["config-teams"] });
    }
  });
  const toggleUser = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) => configApi.updateUser(id, { disabled }),
    onSuccess: () => {
      showToast("账号状态已更新");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
    }
  });
  const toggleConfigAccess = useMutation({
    mutationFn: ({ id, hasConfigAccess }: { id: string; hasConfigAccess: boolean }) =>
      configApi.updateUser(id, { hasConfigAccess }),
    onSuccess: () => {
      showToast("管理权限已更新");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
    }
  });
  const resetPassword = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => configApi.resetPassword(id, password),
    onSuccess: () => {
      setResetUser(null);
      showToast("密码已重置");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
    }
  });
  const deleteUser = useMutation({
    mutationFn: (id: string) => configApi.deleteUser(id),
    onSuccess: () => {
      setDeleteTarget(null);
      showToast("账号已删除");
      queryClient.invalidateQueries({ queryKey: ["config-users"] });
      queryClient.invalidateQueries({ queryKey: ["config-teams"] });
    }
  });

  return (
    <section className="config-card">
      <ConfigHeader title="用户账号" desc="支持按账号、邮箱、手机号、团队和状态搜索筛选普通用户。" />
      <div className="switch-row account-registration-row">
        <div className="switch-row-copy">
          <span>自助注册</span>
          <small>关闭后 C 端无法获取注册验证码或完成注册；后台新增账号不受影响。</small>
        </div>
        <SwitchControl
          checked={registrationEnabled}
          disabled={registrationSettings.isLoading || saveRegistrationSettings.isPending}
          label={registrationEnabled ? "已开启" : "已关闭"}
          onChange={(enabled) => saveRegistrationSettings.mutate(enabled)}
        />
      </div>
      {saveRegistrationSettings.error ? <div className="form-error">{saveRegistrationSettings.error.message}</div> : null}
      <div className="filter-bar">
        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索账号/用户名/邮箱/手机号" />
        <CustomSelect
          value={teamFilter}
          onChange={setTeamFilter}
          options={[
            { value: "", label: "全部团队" },
            ...(teams.data?.teams.map((team) => ({ value: team.id, label: team.name })) ?? [])
          ]}
        />
        <CustomSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "", label: "全部状态" },
            { value: "enabled", label: "启用" },
            { value: "disabled", label: "禁用" }
          ]}
        />
        <button className="secondary-btn" onClick={() => setUserDialog({ mode: "create" })}>
          新增账号
        </button>
      </div>
      <UserTable
        users={users.data?.users ?? []}
        onEdit={(user) => setUserDialog({ mode: "edit", user })}
        onToggle={(user) => setSwitchConfirm({ kind: "status", user })}
        onConfigAccessToggle={(user) => setSwitchConfirm({ kind: "configAccess", user })}
        onReset={(user) => setResetUser(user)}
        onDelete={(user) => setDeleteTarget(user)}
      />
      {userDialog ? (
        <UserDialog
          mode={userDialog.mode}
          user={userDialog.user}
          teams={teams.data?.teams ?? []}
          defaultTeamId={teamFilter || teams.data?.teams[0]?.id}
          onClose={() => setUserDialog(null)}
          onSubmit={(payload) => {
            if (userDialog.mode === "create") {
              createUser.mutate(payload as ConfigUserPayload & { password: string });
            } else {
              updateUser.mutate({
                id: userDialog.user!.id,
                payload: {
                  account: payload.account,
                  username: payload.username,
                  email: payload.email,
                  phone: payload.phone,
                  teamId: payload.teamId,
                  disabled: payload.disabled,
                  hasConfigAccess: payload.hasConfigAccess
                }
              });
            }
          }}
        />
      ) : null}
      <PromptDialog
        open={Boolean(resetUser)}
        title="重置密码"
        label="新密码"
        type="password"
        description={resetUser ? `为账号「${resetUser.account}」设置新密码。` : undefined}
        confirmText="重置密码"
        onCancel={() => setResetUser(null)}
        onSubmit={(password) => {
          if (resetUser) resetPassword.mutate({ id: resetUser.id, password });
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除账号"
        description={deleteTarget ? `确认删除账号「${deleteTarget.account}」？该账号的对话、图片和素材记录会一起删除。` : ""}
        confirmText="删除"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteUser.mutate(deleteTarget.id);
        }}
      />
      <ConfirmDialog
        open={Boolean(switchConfirm)}
        title={switchConfirmCopy.title}
        description={switchConfirmCopy.description}
        confirmText={switchConfirmCopy.confirmText}
        destructive={switchConfirmCopy.destructive}
        onCancel={() => setSwitchConfirm(null)}
        onConfirm={() => {
          if (!switchConfirm) return;
          if (switchConfirm.kind === "status") {
            toggleUser.mutate({ id: switchConfirm.user.id, disabled: !switchConfirm.user.disabled });
          } else {
            toggleConfigAccess.mutate({
              id: switchConfirm.user.id,
              hasConfigAccess: !switchConfirm.user.hasConfigAccess
            });
          }
          setSwitchConfirm(null);
        }}
      />
    </section>
  );
}

function UserTable({
  users,
  onEdit,
  onToggle,
  onConfigAccessToggle,
  onReset,
  onDelete
}: {
  users: ConfigUser[];
  onEdit: (user: ConfigUser) => void;
  onToggle: (user: ConfigUser) => void;
  onConfigAccessToggle: (user: ConfigUser) => void;
  onReset: (user: ConfigUser) => void;
  onDelete: (user: ConfigUser) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>用户名</th>
            <th>账号</th>
            <th>邮箱</th>
            <th>手机号</th>
            <th>团队</th>
            <th>状态</th>
            <th>管理权限</th>
            <th>对话</th>
            <th>图片</th>
            <th>最近登录</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.username}</td>
              <td>{user.account}</td>
              <td>{user.email || "-"}</td>
              <td>{user.phone || "-"}</td>
              <td>{user.teamName}</td>
              <td>
                <SwitchControl
                  checked={!user.disabled}
                  label={user.disabled ? "禁用" : "启用"}
                  onChange={() => onToggle(user)}
                />
              </td>
              <td>
                <SwitchControl
                  checked={user.hasConfigAccess}
                  label={user.hasConfigAccess ? "有" : "无"}
                  onChange={() => onConfigAccessToggle(user)}
                />
              </td>
              <td>{user.sessionCount}</td>
              <td>{user.imageCount}</td>
              <td>{formatDate(user.lastLoginAt)}</td>
              <td>{formatDate(user.createdAt)}</td>
              <td className="row-actions compact-actions">
                <button className="secondary-btn" onClick={() => onEdit(user)}>编辑</button>
                <button className="secondary-btn" onClick={() => onReset(user)}>重置密码</button>
                <button className="danger-btn" onClick={() => onDelete(user)}>删除</button>
              </td>
            </tr>
          ))}
          {users.length === 0 ? (
            <tr>
              <td colSpan={12}>暂无账号</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function TeamDialog({
  mode,
  team,
  onClose,
  onSubmit
}: {
  mode: "create" | "edit";
  team?: Team;
  onClose: () => void;
  onSubmit: (payload: { name: string; description: string }) => void;
}) {
  const [name, setName] = useState(team?.name ?? "");
  const [description, setDescription] = useState(team?.description ?? "");

  return (
    <div className="modal-backdrop">
      <section className="case-modal compact-modal">
        <header>
          <h3>{mode === "create" ? "新增团队" : "编辑团队"}</h3>
          <button onClick={onClose}>关闭</button>
        </header>
        <label>
          团队名称
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>
        <label>
          团队说明
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
        </label>
        <div className="row-actions">
          <button className="secondary-btn" onClick={onClose}>
            取消
          </button>
          <button className="primary-btn" onClick={() => onSubmit({ name, description })} disabled={!name.trim()}>
            保存
          </button>
        </div>
      </section>
    </div>
  );
}

function UserDialog({
  mode,
  user,
  teams,
  defaultTeamId,
  onClose,
  onSubmit
}: {
  mode: "create" | "edit";
  user?: ConfigUser;
  teams: Team[];
  defaultTeamId?: string;
  onClose: () => void;
  onSubmit: (payload: ConfigUserPayload) => void;
}) {
  const [account, setAccount] = useState(user?.account ?? "");
  const [username, setUsername] = useState(user?.username ?? user?.account ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [password, setPassword] = useState("");
  const [teamId, setTeamId] = useState(user?.teamId ?? defaultTeamId ?? teams[0]?.id ?? "");
  const [disabled, setDisabled] = useState(user?.disabled ?? false);
  const [hasConfigAccess, setHasConfigAccess] = useState(user?.hasConfigAccess ?? false);

  return (
    <div className="modal-backdrop">
      <section className="case-modal compact-modal">
        <header>
          <h3>{mode === "create" ? "新增账号" : "编辑账号"}</h3>
          <button onClick={onClose}>关闭</button>
        </header>
        <label>
          账号
          <input value={account} onChange={(event) => setAccount(event.target.value)} autoFocus />
        </label>
        <label>
          用户名
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          邮箱
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="可选，用于邮箱登录和找回密码" />
        </label>
        <label>
          手机号
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="可选，手机号登录预留" />
        </label>
        {mode === "create" ? (
          <label>
            密码
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
        ) : null}
        <label>
          团队
          <CustomSelect
            value={teamId}
            onChange={setTeamId}
            options={teams.map((team) => ({ value: team.id, label: team.name }))}
            placeholder="选择团队"
          />
        </label>
        <div className="switch-row">
          <span>账号状态</span>
          <SwitchControl
            checked={!disabled}
            label={disabled ? "禁用" : "启用"}
            onChange={(checked) => setDisabled(!checked)}
          />
        </div>
        <div className="switch-row">
          <span>管理权限</span>
          <SwitchControl
            checked={hasConfigAccess}
            label={hasConfigAccess ? "有" : "无"}
            onChange={setHasConfigAccess}
          />
        </div>
        <div className="row-actions">
          <button className="secondary-btn" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-btn"
            disabled={!account.trim() || !teamId || (mode === "create" && !password)}
            onClick={() => onSubmit({ account, username, email, phone, password, teamId, disabled, hasConfigAccess })}
          >
            保存
          </button>
        </div>
      </section>
    </div>
  );
}
