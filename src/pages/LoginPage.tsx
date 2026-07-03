import { useEffect, useRef, useState, type SyntheticEvent as ReactSyntheticEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Eye, EyeOff, LockKeyhole, Mail, Moon, RefreshCw, ShieldCheck, Sun, UserRound } from "lucide-react";
import { api, type LoginAssets } from "../api";
import { cx } from "../lib/cx";
import { useI18n } from "../i18n";
import { DEFAULT_SITE_NAME } from "../lib/branding";
import { useToast } from "../ui";
import {
  DEFAULT_LOGIN_ASSETS,
  LOGIN_BACKGROUND_AUTO_INTERVAL_MS,
  LOGIN_BACKGROUND_FADE_MS,
  LOGIN_BACKGROUND_PRELOAD_STEP_MS,
  clearRememberedLogin,
  loginBackgroundsFor,
  loginTitleFallbacksFor,
  loginTitleFor,
  nextLoginBackground,
  normalizeLoginAssets,
  pickLoginBackground,
  readLoginThemePreference,
  readRememberedLogin,
  writeLoginThemePreference,
  writeRememberedLogin,
  type LoginTheme
} from "../lib/loginAssets";

type LoginMode = "login" | "register" | "reset";
type SlideDirection = "left" | "right";

const LOGIN_MODE_ORDER: Record<LoginMode, number> = {
  login: 0,
  register: 1,
  reset: 2
};

function normalizeRegisterEmail(value: string) {
  return value.trim().toLowerCase();
}

function isRegisterEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeRegisterEmail(value));
}

export function LoginPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t } = useI18n();
  const initialLoginTheme = readLoginThemePreference();
  const [rememberedLogin] = useState(readRememberedLogin);
  const [mode, setMode] = useState<LoginMode>("login");
  const [modeSlideDirection, setModeSlideDirection] = useState<SlideDirection>("left");
  const [account, setAccount] = useState(() => rememberedLogin.account);
  const [password, setPassword] = useState(() => rememberedLogin.password);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerCode, setRegisterCode] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerPasswordVisible, setRegisterPasswordVisible] = useState(false);
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState("");
  const [registerConfirmPasswordVisible, setRegisterConfirmPasswordVisible] = useState(false);
  const inviteCode = "";
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [registerCooldown, setRegisterCooldown] = useState(0);
  const [resetCooldown, setResetCooldown] = useState(0);
  const [rememberPassword, setRememberPassword] = useState(() => Boolean(rememberedLogin.account || rememberedLogin.password));
  const [siteName, setSiteName] = useState(DEFAULT_SITE_NAME);
  const [loginAssets, setLoginAssets] = useState<LoginAssets>(DEFAULT_LOGIN_ASSETS);
  const [loginTheme, setLoginTheme] = useState<LoginTheme>(() => initialLoginTheme);
  const [loginBackground, setLoginBackground] = useState(() => pickLoginBackground(initialLoginTheme));
  const [visibleTitleSrc, setVisibleTitleSrc] = useState(() => loginTitleFor(DEFAULT_LOGIN_ASSETS, initialLoginTheme));
  const [titleTransition, setTitleTransition] = useState<"leaving" | "entering" | null>(null);
  const [burnLayer, setBurnLayer] = useState<{ id: number; image: string } | null>(null);
  const [preparedLoginBackground, setPreparedLoginBackground] = useState<string | null>(null);
  const burnTimeoutRef = useRef<number | null>(null);
  const loadedLoginBackgroundsRef = useRef(new Set<string>());
  const loginBackgroundImageCacheRef = useRef(new Map<string, HTMLImageElement>());
  const preloadingLoginBackgroundsRef = useRef(new Map<string, Promise<boolean>>());
  const loginSceneTransitionIdRef = useRef(0);
  const titleLeaveTimeoutRef = useRef<number | null>(null);
  const titleEnterTimeoutRef = useRef<number | null>(null);
  const registrationStatus = useQuery({ queryKey: ["registration-status"], queryFn: api.registrationStatus });
  const branding = useQuery({ queryKey: ["branding"], queryFn: api.branding });
  const registrationEnabled = registrationStatus.data?.enabled !== false;
  const login = useMutation({
    mutationFn: () => api.login(account, password),
    onSuccess: () => {
      if (rememberPassword) {
        writeRememberedLogin(account, password);
      } else {
        clearRememberedLogin();
      }
      queryClient.invalidateQueries({ queryKey: ["me"] });
    }
  });
  const sendRegisterCode = useMutation({
    mutationFn: () => {
      const email = normalizeRegisterEmail(registerEmail);
      if (!isRegisterEmail(email)) throw new Error(t("login.invalidEmail"));
      return api.sendRegisterCode(email);
    },
    onSuccess: (data) => {
      setRegisterCooldown(data.cooldownSeconds);
      showToast(t("login.codeSent"));
    }
  });
  const register = useMutation({
    mutationFn: () => {
      if (registerPassword.length < 6) throw new Error(t("login.passwordTooShort"));
      if (registerPassword !== registerConfirmPassword) throw new Error(t("login.passwordMismatch"));
      const email = normalizeRegisterEmail(registerEmail);
      if (!isRegisterEmail(email)) throw new Error(t("login.invalidEmail"));
      return api.register({
        email,
        code: registerCode,
        password: registerPassword,
        inviteCode
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
    }
  });
  const sendPasswordResetCode = useMutation({
    mutationFn: () => {
      const email = normalizeRegisterEmail(resetEmail);
      if (!isRegisterEmail(email)) throw new Error(t("login.invalidEmail"));
      return api.sendPasswordResetCode(email);
    },
    onSuccess: (data) => {
      setResetCooldown(data.cooldownSeconds);
      showToast(t("login.codeSent"));
    }
  });
  const passwordReset = useMutation({
    mutationFn: () => {
      if (resetPassword.length < 6) throw new Error(t("login.passwordTooShort"));
      if (resetPassword !== resetConfirmPassword) throw new Error(t("login.passwordMismatch"));
      const email = normalizeRegisterEmail(resetEmail);
      if (!isRegisterEmail(email)) throw new Error(t("login.invalidEmail"));
      return api.resetPasswordByEmail({
        email,
        code: resetCode,
        password: resetPassword
      });
    },
    onSuccess: () => {
      setModeSlideDirection("right");
      setMode("login");
      setAccount(normalizeRegisterEmail(resetEmail));
      setPassword("");
      showToast(t("login.resetSuccess"));
    }
  });
  const clearTitleTimers = () => {
    if (titleLeaveTimeoutRef.current) window.clearTimeout(titleLeaveTimeoutRef.current);
    if (titleEnterTimeoutRef.current) window.clearTimeout(titleEnterTimeoutRef.current);
    titleLeaveTimeoutRef.current = null;
    titleEnterTimeoutRef.current = null;
  };

  const switchLoginMode = (nextMode: LoginMode) => {
    if (nextMode === "register" && !registrationEnabled) return;
    if (nextMode === mode) return;
    setModeSlideDirection(LOGIN_MODE_ORDER[nextMode] > LOGIN_MODE_ORDER[mode] ? "left" : "right");
    setMode(nextMode);
    login.reset();
    register.reset();
    sendRegisterCode.reset();
    passwordReset.reset();
    sendPasswordResetCode.reset();
  };

  useEffect(() => {
    if (registrationEnabled || mode !== "register") return;
    setModeSlideDirection("right");
    setMode("login");
    register.reset();
    sendRegisterCode.reset();
  }, [mode, register, registrationEnabled, sendRegisterCode]);

  useEffect(() => {
    if (registerCooldown <= 0 && resetCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setRegisterCooldown((value) => Math.max(0, value - 1));
      setResetCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [registerCooldown, resetCooldown]);

  const markLoginBackgroundLoaded = (imageSrc: string, image?: HTMLImageElement) => {
    if (!imageSrc) return;
    loadedLoginBackgroundsRef.current.add(imageSrc);
    if (image) loginBackgroundImageCacheRef.current.set(imageSrc, image);
  };

  const preloadLoginBackground = (imageSrc: string) => {
    if (!imageSrc) return Promise.resolve(false);
    const cachedImage = loginBackgroundImageCacheRef.current.get(imageSrc);
    if (loadedLoginBackgroundsRef.current.has(imageSrc) && cachedImage?.complete && cachedImage.naturalWidth > 0) {
      return Promise.resolve(true);
    }
    const pendingPreload = preloadingLoginBackgroundsRef.current.get(imageSrc);
    if (pendingPreload) return pendingPreload;

    const preload = new Promise<boolean>((resolve) => {
      const image = new Image();
      image.decoding = "async";
      image.loading = "eager";
      image.onload = () => {
        const decodePromise = typeof image.decode === "function" ? image.decode().catch(() => undefined) : Promise.resolve();
        void decodePromise.then(() => {
          markLoginBackgroundLoaded(imageSrc, image);
          resolve(true);
        });
      };
      image.onerror = () => {
        loginBackgroundImageCacheRef.current.delete(imageSrc);
        resolve(false);
      };
      image.src = imageSrc;
    }).finally(() => {
      preloadingLoginBackgroundsRef.current.delete(imageSrc);
    });

    preloadingLoginBackgroundsRef.current.set(imageSrc, preload);
    return preload;
  };

  const pickSmoothLoginBackground = (theme: LoginTheme, previous: string) => {
    const backgrounds = loginBackgroundsFor(loginAssets, theme);
    if (
      preparedLoginBackground &&
      preparedLoginBackground !== previous &&
      backgrounds.includes(preparedLoginBackground) &&
      loadedLoginBackgroundsRef.current.has(preparedLoginBackground)
    ) {
      return preparedLoginBackground;
    }
    const readyCandidates = backgrounds.filter((item) => item !== previous && loadedLoginBackgroundsRef.current.has(item));
    if (readyCandidates.length > 0) {
      return readyCandidates[Math.floor(Math.random() * readyCandidates.length)] ?? readyCandidates[0] ?? previous;
    }
    return pickLoginBackground(theme, previous, loginAssets);
  };

  useEffect(() => {
    const preloadOrder = Array.from(
      new Set([
        loginBackground,
        ...loginBackgroundsFor(loginAssets, loginTheme),
        ...loginBackgroundsFor(loginAssets, loginTheme === "light" ? "dark" : "light")
      ])
    );
    let active = true;
    const preloadTimers: number[] = [];
    preloadOrder.forEach((imageSrc, index) => {
      if (!imageSrc) return;
      const preload = () => {
        if (active) void preloadLoginBackground(imageSrc);
      };
      if (index < 3) {
        preload();
        return;
      }
      preloadTimers.push(window.setTimeout(preload, LOGIN_BACKGROUND_PRELOAD_STEP_MS * (index - 2)));
    });
    return () => {
      active = false;
      preloadTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [loginAssets, loginBackground, loginTheme]);

  useEffect(() => {
    let active = true;
    void preloadLoginBackground(loginBackground).then((loaded) => {
      if (!active || loaded) return;
      setLoginBackground((current) => (current === loginBackground ? nextLoginBackground(loginTheme, current, loginAssets) : current));
    });
    return () => {
      active = false;
    };
  }, [loginAssets, loginBackground, loginTheme]);

  useEffect(() => {
    const backgrounds = loginBackgroundsFor(loginAssets, loginTheme);
    if (backgrounds.length < 2) {
      setPreparedLoginBackground(null);
      return;
    }
    const nextBackground = nextLoginBackground(loginTheme, loginBackground, loginAssets);
    setPreparedLoginBackground(nextBackground === loginBackground ? null : nextBackground);
    void preloadLoginBackground(nextBackground);
  }, [loginAssets, loginBackground, loginTheme]);

  useEffect(
    () => () => {
      if (burnTimeoutRef.current) window.clearTimeout(burnTimeoutRef.current);
      loginSceneTransitionIdRef.current += 1;
      clearTitleTimers();
    },
    []
  );

  useEffect(() => {
    if (!branding.data) {
      if (branding.error) setLoginAssets(DEFAULT_LOGIN_ASSETS);
      return;
    }
    const nextAssets = normalizeLoginAssets(branding.data.loginAssets);
    setSiteName(branding.data.siteName?.trim() || DEFAULT_SITE_NAME);
    setLoginAssets(nextAssets);
    setLoginBackground((current) =>
      loginBackgroundsFor(nextAssets, loginTheme).includes(current)
        ? current
        : pickLoginBackground(loginTheme, current, nextAssets)
    );
    setVisibleTitleSrc((current) =>
      current === loginTitleFor(DEFAULT_LOGIN_ASSETS, loginTheme) ? loginTitleFor(nextAssets, loginTheme) : current
    );
  }, [branding.data, branding.error, loginTheme]);

  useEffect(() => {
    if (loginBackgroundsFor(loginAssets, loginTheme).length < 2) return;
    const nextBackground = pickSmoothLoginBackground(loginTheme, loginBackground);
    void preloadLoginBackground(nextBackground);
    const timer = window.setTimeout(() => {
      updateLoginScene(loginTheme, nextBackground);
    }, LOGIN_BACKGROUND_AUTO_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [loginAssets, loginBackground, loginTheme, preparedLoginBackground]);

  const updateLoginScene = (theme: LoginTheme, background: string) => {
    const backgroundChanged = background !== loginBackground;
    const nextTitleSrc = loginTitleFor(loginAssets, theme);
    if (nextTitleSrc !== visibleTitleSrc) {
      clearTitleTimers();
      setTitleTransition("leaving");
      titleLeaveTimeoutRef.current = window.setTimeout(() => {
        setVisibleTitleSrc(nextTitleSrc);
        setTitleTransition("entering");
        titleEnterTimeoutRef.current = window.setTimeout(() => {
          setTitleTransition(null);
          titleEnterTimeoutRef.current = null;
        }, 620);
        titleLeaveTimeoutRef.current = null;
      }, 760);
    }
    setLoginTheme(theme);
    writeLoginThemePreference(theme);
    if (!backgroundChanged) return;

    const transitionId = loginSceneTransitionIdRef.current + 1;
    const previousBackground = loginBackground;
    loginSceneTransitionIdRef.current = transitionId;
    if (burnTimeoutRef.current) window.clearTimeout(burnTimeoutRef.current);
    void preloadLoginBackground(background).then((loaded) => {
      if (!loaded) return;
      if (loginSceneTransitionIdRef.current !== transitionId) return;
      setBurnLayer({ id: transitionId, image: previousBackground });
      setLoginBackground(background);
      burnTimeoutRef.current = window.setTimeout(() => {
        if (loginSceneTransitionIdRef.current === transitionId) setBurnLayer(null);
        burnTimeoutRef.current = null;
      }, LOGIN_BACKGROUND_FADE_MS);
    });
  };

  const selectLoginTheme = (theme: LoginTheme) => {
    const nextBackground = theme === loginTheme ? loginBackground : pickSmoothLoginBackground(theme, loginBackground);
    updateLoginScene(theme, nextBackground);
  };

  const randomizeLoginBackground = () => {
    updateLoginScene(loginTheme, pickSmoothLoginBackground(loginTheme, loginBackground));
  };

  const handleTitleArtError = (event: ReactSyntheticEvent<HTMLImageElement>) => {
    const titleFallbacks = loginTitleFallbacksFor(loginAssets);
    const currentFallbackIndex = titleFallbacks.findIndex((item) => event.currentTarget.src.endsWith(item));
    const attemptedFallbackIndex = Number(event.currentTarget.dataset.titleFallbackIndex ?? "-1");
    const nextFallbackIndex = Math.max(currentFallbackIndex, attemptedFallbackIndex) + 1;
    const nextTitle = titleFallbacks[nextFallbackIndex];
    if (!nextTitle) return;
    event.currentTarget.dataset.titleFallbackIndex = String(nextFallbackIndex);
    event.currentTarget.src = nextTitle;
  };

  return (
    <main className={cx("login-page", `login-theme-${loginTheme}`)}>
      <span className="login-background-layer" aria-hidden="true">
        <img
          src={loginBackground}
          alt=""
          draggable={false}
          onLoad={(event) => markLoginBackgroundLoaded(loginBackground, event.currentTarget)}
        />
      </span>
      {preparedLoginBackground && preparedLoginBackground !== loginBackground ? (
        <span className="login-preload-layer" aria-hidden="true">
          <img
            src={preparedLoginBackground}
            alt=""
            draggable={false}
            onLoad={(event) => markLoginBackgroundLoaded(preparedLoginBackground, event.currentTarget)}
          />
        </span>
      ) : null}
      {burnLayer ? (
        <span key={burnLayer.id} className="login-burn-layer" aria-hidden="true">
          <img src={burnLayer.image} alt="" draggable={false} />
        </span>
      ) : null}
      <div className="login-theme-switch" aria-label={t("login.themeSwitch")}>
        <button
          className={cx(loginTheme === "light" && "active")}
          type="button"
          aria-pressed={loginTheme === "light"}
          onClick={() => selectLoginTheme("light")}
        >
          <Sun size={15} aria-hidden="true" />
          <span>{t("login.lightTheme")}</span>
        </button>
        <button
          className={cx(loginTheme === "dark" && "active")}
          type="button"
          aria-pressed={loginTheme === "dark"}
          onClick={() => selectLoginTheme("dark")}
        >
          <Moon size={15} aria-hidden="true" />
          <span>{t("login.darkTheme")}</span>
        </button>
        <button type="button" aria-label={t("login.randomBackground")} onClick={randomizeLoginBackground}>
          <RefreshCw size={15} aria-hidden="true" />
          <span>{t("login.randomBackground")}</span>
        </button>
      </div>
      <div className="login-side">
        <div className="login-title-wrap">
          <img
            key={visibleTitleSrc}
            className={cx("login-title-art", titleTransition === "leaving" && "is-leaving", titleTransition === "entering" && "is-entering")}
            src={visibleTitleSrc}
            alt={siteName}
            onError={handleTitleArtError}
          />
        </div>
        <section className="login-panel">
          {registrationEnabled ? (
            <div
              className={cx("login-mode-tabs", mode === "register" && "is-register", mode === "reset" && "is-reset")}
              role="tablist"
              aria-label={t("login.modeTabs")}
            >
              <button className={cx(mode === "login" && "active")} type="button" onClick={() => switchLoginMode("login")}>
                {t("login.login")}
              </button>
              <button className={cx(mode === "register" && "active")} type="button" onClick={() => switchLoginMode("register")}>
                {t("login.register")}
              </button>
            </div>
          ) : null}
          <div className={cx("login-form-stage", modeSlideDirection === "left" ? "slide-left" : "slide-right")}>
          {mode === "login" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                login.mutate();
              }}
              className="login-form"
            >
              <label className="login-field">
                <span className="visually-hidden">{t("login.account")}</span>
                <span className="login-input-shell">
                  <UserRound size={21} className="login-input-icon" aria-hidden="true" />
                  <input
                    value={account}
                    onChange={(event) => setAccount(event.target.value)}
                    placeholder={t("login.accountPlaceholder")}
                    autoComplete="username"
                    autoFocus
                  />
                </span>
              </label>
              <label className="login-field">
                <span className="visually-hidden">{t("login.password")}</span>
                <span className="login-input-shell">
                  <LockKeyhole size={20} className="login-input-icon" aria-hidden="true" />
                  <input
                    className="login-password-input"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type={passwordVisible ? "text" : "password"}
                    placeholder={t("login.passwordPlaceholder")}
                    autoComplete="current-password"
                  />
                  <button
                    className="login-password-toggle"
                    type="button"
                    aria-label={passwordVisible ? t("login.hidePassword") : t("login.showPassword")}
                    aria-pressed={passwordVisible}
                    onClick={() => setPasswordVisible((value) => !value)}
                  >
                    {passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
              </label>
              <div className="login-options">
                <label className="remember-password">
                  <input
                    checked={rememberPassword}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setRememberPassword(checked);
                      if (!checked) clearRememberedLogin();
                    }}
                    type="checkbox"
                  />
                  <span className="remember-check" aria-hidden="true">
                    {rememberPassword ? <Check size={13} /> : null}
                  </span>
                  <span>{t("login.rememberPassword")}</span>
                </label>
                <button className="forgot-password-link" type="button" onClick={() => switchLoginMode("reset")}>
                  {t("login.forgotPassword")}
                </button>
              </div>
              {login.error ? <div className="form-error">{login.error.message}</div> : null}
              <button className="primary-btn login-submit" disabled={login.isPending}>
                {login.isPending ? t("login.loggingIn") : t("login.login")}
              </button>
            </form>
          ) : null}
          {mode === "register" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                register.mutate();
              }}
              className="login-form login-form-compact"
            >
              <label className="login-field">
                <span className="visually-hidden">{t("login.email")}</span>
                <span className="login-input-shell">
                  <Mail size={20} className="login-input-icon" aria-hidden="true" />
                  <input
                    value={registerEmail}
                    onChange={(event) => setRegisterEmail(event.target.value)}
                    placeholder={t("login.emailPlaceholder")}
                    autoComplete="email"
                    inputMode="email"
                    autoFocus
                  />
                </span>
              </label>
              <label className="login-field">
                <span className="visually-hidden">{t("login.code")}</span>
                <span className="login-input-shell">
                  <ShieldCheck size={20} className="login-input-icon" aria-hidden="true" />
                  <input value={registerCode} onChange={(event) => setRegisterCode(event.target.value)} placeholder={t("login.code")} inputMode="numeric" />
                  <button
                    className="login-code-button"
                    type="button"
                    disabled={sendRegisterCode.isPending || registerCooldown > 0 || !registerEmail.trim()}
                    onClick={() => sendRegisterCode.mutate()}
                  >
                    {registerCooldown > 0 ? `${registerCooldown}s` : sendRegisterCode.isPending ? t("login.sending") : t("login.getCode")}
                  </button>
                </span>
              </label>
              <label className="login-field">
                <span className="visually-hidden">{t("login.password")}</span>
                <span className="login-input-shell">
                  <LockKeyhole size={20} className="login-input-icon" aria-hidden="true" />
                  <input
                    className="login-password-input"
                    value={registerPassword}
                    onChange={(event) => setRegisterPassword(event.target.value)}
                    type={registerPasswordVisible ? "text" : "password"}
                    placeholder={t("login.registerPasswordPlaceholder")}
                    autoComplete="new-password"
                  />
                  <button
                    className="login-password-toggle"
                    type="button"
                    aria-label={registerPasswordVisible ? t("login.hidePassword") : t("login.showPassword")}
                    aria-pressed={registerPasswordVisible}
                    onClick={() => setRegisterPasswordVisible((value) => !value)}
                  >
                    {registerPasswordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
              </label>
              <label className="login-field">
                <span className="visually-hidden">{t("login.confirmPassword")}</span>
                <span className="login-input-shell">
                  <LockKeyhole size={20} className="login-input-icon" aria-hidden="true" />
                  <input
                    className="login-password-input"
                    value={registerConfirmPassword}
                    onChange={(event) => setRegisterConfirmPassword(event.target.value)}
                    type={registerConfirmPasswordVisible ? "text" : "password"}
                    placeholder={t("login.confirmPasswordPlaceholder")}
                    autoComplete="new-password"
                  />
                  <button
                    className="login-password-toggle"
                    type="button"
                    aria-label={registerConfirmPasswordVisible ? t("login.hidePassword") : t("login.showPassword")}
                    aria-pressed={registerConfirmPasswordVisible}
                    onClick={() => setRegisterConfirmPasswordVisible((value) => !value)}
                  >
                    {registerConfirmPasswordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
              </label>
              {sendRegisterCode.error ? <div className="form-error">{sendRegisterCode.error.message}</div> : null}
              {register.error ? <div className="form-error">{register.error.message}</div> : null}
              <button className="primary-btn login-submit" disabled={register.isPending}>
                {register.isPending ? t("login.registering") : t("login.registerSubmit")}
              </button>
            </form>
          ) : null}
          {mode === "reset" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                passwordReset.mutate();
              }}
              className="login-form login-form-compact"
            >
              <button className="forgot-password-link login-back-link" type="button" onClick={() => switchLoginMode("login")}>
                {t("login.backToLogin")}
              </button>
              <label className="login-field">
                <span className="visually-hidden">{t("login.email")}</span>
                <span className="login-input-shell">
                  <Mail size={20} className="login-input-icon" aria-hidden="true" />
                  <input
                    value={resetEmail}
                    onChange={(event) => setResetEmail(event.target.value)}
                    placeholder={t("login.resetEmailPlaceholder")}
                    autoComplete="email"
                    inputMode="email"
                    autoFocus
                  />
                </span>
              </label>
              <label className="login-field">
                <span className="visually-hidden">{t("login.code")}</span>
                <span className="login-input-shell">
                  <ShieldCheck size={20} className="login-input-icon" aria-hidden="true" />
                  <input value={resetCode} onChange={(event) => setResetCode(event.target.value)} placeholder={t("login.emailCode")} inputMode="numeric" />
                  <button
                    className="login-code-button"
                    type="button"
                    disabled={sendPasswordResetCode.isPending || resetCooldown > 0 || !resetEmail.trim()}
                    onClick={() => sendPasswordResetCode.mutate()}
                  >
                    {resetCooldown > 0 ? `${resetCooldown}s` : sendPasswordResetCode.isPending ? t("login.sending") : t("login.getCode")}
                  </button>
                </span>
              </label>
              <label className="login-field">
                <span className="visually-hidden">{t("login.newPassword")}</span>
                <span className="login-input-shell">
                  <LockKeyhole size={20} className="login-input-icon" aria-hidden="true" />
                  <input className="login-password-input" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} type="password" placeholder={t("login.resetPasswordPlaceholder")} autoComplete="new-password" />
                </span>
              </label>
              <label className="login-field">
                <span className="visually-hidden">{t("login.confirmResetPassword")}</span>
                <span className="login-input-shell">
                  <LockKeyhole size={20} className="login-input-icon" aria-hidden="true" />
                  <input className="login-password-input" value={resetConfirmPassword} onChange={(event) => setResetConfirmPassword(event.target.value)} type="password" placeholder={t("login.confirmResetPasswordPlaceholder")} autoComplete="new-password" />
                </span>
              </label>
              {sendPasswordResetCode.error ? <div className="form-error">{sendPasswordResetCode.error.message}</div> : null}
              {passwordReset.error ? <div className="form-error">{passwordReset.error.message}</div> : null}
              <button className="primary-btn login-submit" disabled={passwordReset.isPending}>
                {passwordReset.isPending ? t("login.resetting") : t("login.resetPassword")}
              </button>
            </form>
          ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
