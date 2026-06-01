import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, Bell, Loader2, LogOut, Palette, User } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useDeliveryHealthQuery, useUpdateMe } from "@/lib/queries";
import type { PersonalChannelMode } from "@/lib/types";
import { ApiError } from "@/lib/api";
import {
  getDesktopNotificationPermission,
  isDesktopNotificationsOptedIn,
  isDesktopNotificationsSupported,
  requestDesktopNotificationPermission,
  setDesktopNotificationsOptIn,
  type DesktopNotificationPermission,
} from "@/lib/browserDesktopNotifications";

const tabs = [
  { id: "profile", label: "Профиль", icon: User },
  { id: "notifications", label: "Уведомления", icon: Bell },
  { id: "appearance", label: "Внешний вид", icon: Palette },
] as const;

type Tab = typeof tabs[number]["id"];

export default function SettingsPage() {
  const { me, currentUser, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const updateMe = useUpdateMe();
  const [tab, setTab] = useState<Tab>("profile");
  const deliveryHealth = useDeliveryHealthQuery(tab === "notifications");

  const [telegramEdit, setTelegramEdit] = useState("");
  const [matrixEdit, setMatrixEdit] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [desktopNotifSupported, setDesktopNotifSupported] = useState(false);
  const [desktopNotifPermission, setDesktopNotifPermission] = useState<DesktopNotificationPermission>("default");
  const [desktopNotifEnabled, setDesktopNotifEnabled] = useState(false);

  useEffect(() => {
    if (!me) return;
    setTelegramEdit(me.telegram_id ?? "");
    setMatrixEdit(me.matrix_id ?? "");
  }, [me?.telegram_id, me?.matrix_id, me]);

  useEffect(() => {
    setDesktopNotifSupported(isDesktopNotificationsSupported());
    setDesktopNotifPermission(getDesktopNotificationPermission());
    setDesktopNotifEnabled(isDesktopNotificationsOptedIn());
  }, []);

  const handleDesktopNotifToggle = async (enabled: boolean) => {
    if (!enabled) {
      setDesktopNotificationsOptIn(false);
      setDesktopNotifEnabled(false);
      toast.success("Системные уведомления выключены");
      return;
    }
    if (!isDesktopNotificationsSupported()) {
      toast.error("Браузер не поддерживает системные уведомления");
      return;
    }
    const permission = await requestDesktopNotificationPermission();
    setDesktopNotifPermission(permission);
    if (permission === "granted") {
      setDesktopNotificationsOptIn(true);
      setDesktopNotifEnabled(true);
      toast.success("Системные уведомления включены");
    } else if (permission === "denied") {
      setDesktopNotificationsOptIn(false);
      setDesktopNotifEnabled(false);
      toast.error("Браузер запретил уведомления — разрешите их в настройках сайта");
    } else {
      setDesktopNotificationsOptIn(false);
      setDesktopNotifEnabled(false);
    }
  };

  const handleLogout = () => {
    logout();
    toast.success("Вы вышли из системы");
    navigate("/login", { replace: true });
  };

  const handleSaveContacts = async () => {
    if (!me) return;
    try {
      await updateMe.mutateAsync({
        telegram_id: telegramEdit.trim() || null,
        matrix_id: matrixEdit.trim() || null,
      });
      await refresh();
      toast.success("Контакты сохранены");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось сохранить");
    }
  };

  const handlePersonalChannelMode = async (mode: PersonalChannelMode) => {
    if (!me) return;
    try {
      await updateMe.mutateAsync({ personal_channel_mode: mode });
      await refresh();
      toast.success("Режим личных каналов сохранён");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось сохранить");
    }
  };

  const handleChangePassword = async () => {
    if (!me) return;
    if (newPassword.length < 6) {
      toast.error("Новый пароль — не короче 6 символов");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Новый пароль и подтверждение не совпадают");
      return;
    }
    try {
      await updateMe.mutateAsync({
        current_password: currentPassword,
        new_password: newPassword,
      });
      await refresh();
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Пароль изменён");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось сменить пароль");
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Настройки</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Управление аккаунтом и системой</p>
      </div>

      {/* Mobile: horizontal tab bar */}
      <div className="flex gap-1 mb-5 overflow-x-auto pb-1 md:hidden">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0 ${tab === t.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
            data-testid={`settings-tab-${t.id}`}
          >
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex gap-5">
        {/* Desktop: vertical tab nav */}
        <div className="hidden md:block w-44 flex-shrink-0">
          <nav className="space-y-0.5">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left ${tab === t.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
                data-testid={`settings-tab-${t.id}`}
              >
                <t.icon size={15} />
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        <div className="flex-1 min-w-0">
          {tab === "profile" && (
            <div className="space-y-4">
              <div className="bg-card border border-border rounded-xl p-4 md:p-5 space-y-4">
                <h3 className="text-sm font-semibold text-foreground">Информация профиля</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Логин">{currentUser.name}</Field>
                  <Field label="Роль">{currentUser.role}</Field>
                </div>
              </div>

              {me && (
                <>
                  <div className="bg-card border border-border rounded-xl p-4 md:p-5 space-y-4">
                    <h3 className="text-sm font-semibold text-foreground">Telegram и Matrix</h3>
                    <p className="text-xs text-muted-foreground">
                      Можно сохранить контакты на будущее. Личные внешние уведомления сейчас временно отключены.
                    </p>
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1.5" htmlFor="settings-telegram">
                          Telegram
                        </label>
                        <input
                          id="settings-telegram"
                          type="text"
                          value={telegramEdit}
                          onChange={(e) => setTelegramEdit(e.target.value)}
                          placeholder="например 123456789 или @nickname"
                          autoComplete="off"
                          className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                          data-testid="input-settings-telegram"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1.5" htmlFor="settings-matrix">
                          Matrix
                        </label>
                        <input
                          id="settings-matrix"
                          type="text"
                          value={matrixEdit}
                          onChange={(e) => setMatrixEdit(e.target.value)}
                          placeholder="@user:matrix.example.org"
                          autoComplete="off"
                          className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                          data-testid="input-settings-matrix"
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          Личные сообщения в Matrix временно отключены: бот сейчас не может создавать защищённые личные комнаты.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveContacts}
                      disabled={updateMe.isPending}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
                      data-testid="button-save-contacts"
                    >
                      {updateMe.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
                      Сохранить контакты
                    </button>
                  </div>

                  <form
                    className="bg-card border border-border rounded-xl p-4 md:p-5 space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleChangePassword();
                    }}
                    data-testid="form-settings-password"
                  >
                    <input
                      type="text"
                      name="username"
                      autoComplete="username"
                      readOnly
                      tabIndex={-1}
                      aria-hidden="true"
                      value={me?.username ?? ""}
                      className="sr-only pointer-events-none absolute w-px h-px p-0 -m-px overflow-hidden border-0"
                    />
                    <h3 className="text-sm font-semibold text-foreground">Пароль</h3>
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1.5" htmlFor="settings-current-pw">
                          Текущий пароль
                        </label>
                        <input
                          id="settings-current-pw"
                          type="password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          autoComplete="current-password"
                          className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                          data-testid="input-settings-current-password"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1.5" htmlFor="settings-new-pw">
                          Новый пароль
                        </label>
                        <input
                          id="settings-new-pw"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          autoComplete="new-password"
                          className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                          data-testid="input-settings-new-password"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1.5" htmlFor="settings-confirm-pw">
                          Подтверждение
                        </label>
                        <input
                          id="settings-confirm-pw"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          autoComplete="new-password"
                          className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                          data-testid="input-settings-confirm-password"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={updateMe.isPending || !currentPassword || !newPassword}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
                      data-testid="button-change-password"
                    >
                      {updateMe.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
                      Сменить пароль
                    </button>
                  </form>
                </>
              )}

              <div className="bg-card border border-border rounded-xl p-4 md:p-5 flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Смена логина — через администратора.
                </p>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/20 transition-colors shrink-0"
                >
                  <LogOut size={13} /> Выйти
                </button>
              </div>
            </div>
          )}

          {tab === "notifications" && (
            <div className="bg-card border border-border rounded-xl p-4 md:p-5 space-y-5">
              <h3 className="text-sm font-semibold text-foreground">Настройки уведомлений</h3>
              {[
                { label: "Уведомления в системе", sub: "Внутренние уведомления всегда включены", value: true, id: "notif-app" },
                { label: "Упоминания", sub: "Настраиваемое отключение пока не подключено", value: true, id: "notif-mention" },
                { label: "Вопрос долго без движения", sub: "Настраиваемое отключение пока не подключено", value: true, id: "notif-sla" },
              ].map(n => (
                <div key={n.id} className="flex items-center justify-between gap-4 opacity-70">
                  <div>
                    <p className="text-sm font-medium text-foreground">{n.label}</p>
                    <p className="text-xs text-muted-foreground">{n.sub}</p>
                  </div>
                  <Switch checked={n.value} disabled data-testid={n.id} />
                </div>
              ))}

              <div className="space-y-2 pt-4 border-t border-border">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">Системные уведомления браузера</p>
                    <p className="text-xs text-muted-foreground">
                      Показывать всплывающие уведомления в системном трее, пока открыта вкладка
                    </p>
                  </div>
                  <Switch
                    checked={desktopNotifEnabled && desktopNotifPermission === "granted"}
                    disabled={!desktopNotifSupported || desktopNotifPermission === "denied"}
                    onCheckedChange={(v) => { void handleDesktopNotifToggle(v); }}
                    data-testid="notif-desktop"
                  />
                </div>
                {!desktopNotifSupported ? (
                  <p className="text-xs text-muted-foreground">
                    Этот браузер не поддерживает Web Notifications API.
                  </p>
                ) : desktopNotifPermission === "denied" ? (
                  <Alert variant="destructive" className="py-2.5">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle className="text-sm">Уведомления заблокированы</AlertTitle>
                    <AlertDescription className="text-xs">
                      Разрешите уведомления для этого сайта в настройках браузера, затем включите переключатель снова.
                    </AlertDescription>
                  </Alert>
                ) : null}
              </div>

              {me && (
                <div className="space-y-4 pt-4 border-t border-border">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">Уведомления в Telegram</p>
                        <p className="text-xs text-muted-foreground">Временно недоступно в текущем окружении</p>
                      </div>
                      <Switch
                        checked={false}
                        disabled
                        data-testid="notif-telegram"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Контакт можно сохранить в профиле, но доставка в Telegram сейчас не используется.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">Уведомления в Matrix</p>
                        <p className="text-xs text-muted-foreground">Личные сообщения временно отключены</p>
                      </div>
                      <Switch
                        checked={false}
                        disabled
                        data-testid="notif-matrix"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Matrix-комнаты проекта, утренний и вечерний дайджесты продолжают работать. Отключены только личные сообщения.
                    </p>
                  </div>

                  <div className="space-y-2 pt-2">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5" htmlFor="personal-channel-mode">
                        Личные каналы
                      </label>
                      <p className="text-xs text-muted-foreground mb-2">
                        Селект временно закрыт: личные Matrix и Telegram-уведомления не используются в демо-окружении.
                      </p>
                      <select
                        id="personal-channel-mode"
                        value={(me.personal_channel_mode as PersonalChannelMode) ?? "both"}
                        disabled
                        onChange={(e) => {
                          void handlePersonalChannelMode(e.target.value as PersonalChannelMode);
                        }}
                        className="w-full max-w-md"
                        data-testid="select-personal-channel-mode"
                      >
                        <option value="both">Оба канала</option>
                        <option value="matrix_preferred">Сначала Matrix</option>
                        <option value="telegram_preferred">Сначала Telegram</option>
                        <option value="in_app_only">Не дублировать во внешние каналы</option>
                      </select>
                    </div>
                  </div>

                  {deliveryHealth.data && deliveryHealth.data.issues.length > 0 ? (
                    <div className="space-y-2 pt-4 border-t border-border">
                      <p className="text-sm font-medium text-foreground">Сводка доставки (каналы)</p>
                      <p className="text-xs text-muted-foreground">
                        Внутренние уведомления в Resonance сохраняются всегда; ниже — только проблемы с внешними каналами.
                      </p>
                      <Alert variant="destructive" className="py-2.5">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle className="text-sm">Проверьте интеграцию</AlertTitle>
                        <AlertDescription className="text-xs space-y-1">
                          {deliveryHealth.data.issues.map((issue) => (
                            <p key={issue}>{issue}</p>
                          ))}
                        </AlertDescription>
                      </Alert>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}

          {tab === "appearance" && (
            <div className="bg-card border border-border rounded-xl p-4 md:p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Внешний вид</h3>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Тёмная тема</p>
                  <p className="text-xs text-muted-foreground">Основной режим</p>
                </div>
                <Switch checked={true} onCheckedChange={() => toast.info("Тёмная тема — основной режим")} data-testid="switch-dark-mode" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Компактный режим</p>
                  <p className="text-xs text-muted-foreground">Более плотное расположение</p>
                </div>
                <Switch checked={false} onCheckedChange={() => toast.info("В разработке")} data-testid="switch-compact" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm text-foreground">{children}</p>
    </div>
  );
}
