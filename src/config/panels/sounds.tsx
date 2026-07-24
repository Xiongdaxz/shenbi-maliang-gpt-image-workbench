import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Pencil, Play, Square, Trash2, Upload, Volume2, X } from "lucide-react";
import { configApi } from "../../api";
import type { ConfigImageTaskSound } from "../../api/config";
import { formatImageFileSize } from "../../lib/format";
import { playImageTaskSound, stopImageTaskSoundPlayback } from "../../lib/imageTaskSoundPlayer";
import { ConfirmDialog, PromptDialog, useToast } from "../../ui";
import { ConfigHeader, SwitchControl } from "../shared";

const MIXKIT_SOUND_EFFECTS_URL = "https://mixkit.co/free-sound-effects/";

function UploadSoundDialog({
  open,
  file,
  name,
  pending,
  error,
  onNameChange,
  onCancel,
  onSubmit
}: {
  open: boolean;
  file: File | null;
  name: string;
  pending: boolean;
  error: string;
  onNameChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  if (!open || !file) return null;
  return createPortal(
    <div className="modal-backdrop">
      <section className="case-modal compact-modal sound-upload-modal" role="dialog" aria-modal="true" aria-label="上传提示音">
        <header>
          <h3>上传提示音</h3>
          <button type="button" onClick={onCancel} disabled={pending} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <div className="sound-upload-file">
          <Volume2 size={20} aria-hidden="true" />
          <div>
            <strong>{file.name}</strong>
            <span>{formatImageFileSize(file.size)}</span>
          </div>
        </div>
        <label>
          显示名称
          <input value={name} maxLength={60} autoFocus onChange={(event) => onNameChange(event.target.value)} />
        </label>
        <p className="muted">仅支持 MP3、WAV、OGG，单文件不超过 5MB。请确认你拥有相应的使用权。</p>
        {error ? <div className="form-error">{error}</div> : null}
        <div className="row-actions">
          <button className="secondary-btn" type="button" onClick={onCancel} disabled={pending}>取消</button>
          <button className="primary-btn" type="button" onClick={onSubmit} disabled={pending || !name.trim()}>
            <Upload size={16} /> {pending ? "上传中" : "上传"}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

export function ImageTaskSoundManagementPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [renameTarget, setRenameTarget] = useState<ConfigImageTaskSound | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConfigImageTaskSound | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const soundsQuery = useQuery({
    queryKey: ["config-image-task-sounds"],
    queryFn: configApi.imageTaskSounds
  });
  const sounds = soundsQuery.data?.sounds ?? [];
  const sourceUrl = soundsQuery.data?.sourceUrl || MIXKIT_SOUND_EFFECTS_URL;

  const acceptResult = (data: Awaited<ReturnType<typeof configApi.imageTaskSounds>>) => {
    queryClient.setQueryData(["config-image-task-sounds"], data);
    void queryClient.invalidateQueries({ queryKey: ["image-task-sounds"] });
  };

  const upload = useMutation({
    mutationFn: () => {
      if (!uploadFile) throw new Error("请选择要上传的音频");
      const form = new FormData();
      form.set("file", uploadFile);
      form.set("name", uploadName.trim());
      return configApi.uploadImageTaskSound(form);
    },
    onSuccess: (data) => {
      acceptResult(data);
      setUploadFile(null);
      setUploadName("");
      showToast("提示音已上传");
    }
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; enabled?: boolean } }) =>
      configApi.updateImageTaskSound(id, patch),
    onSuccess: (data, variables) => {
      acceptResult(data);
      setRenameTarget(null);
      showToast(variables.patch.name !== undefined ? "提示音名称已更新" : variables.patch.enabled ? "提示音已启用" : "提示音已停用");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "提示音更新失败", "error")
  });

  const remove = useMutation({
    mutationFn: (id: string) => configApi.deleteImageTaskSound(id),
    onSuccess: (data) => {
      acceptResult(data);
      setDeleteTarget(null);
      showToast("提示音已删除");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "提示音删除失败", "error")
  });

  const stopPreview = () => {
    stopImageTaskSoundPlayback();
    setPlayingId(null);
  };

  const togglePreview = (sound: ConfigImageTaskSound) => {
    if (playingId === sound.id) {
      stopPreview();
      return;
    }
    setPlayingId(sound.id);
    const started = playImageTaskSound(sound.url, 70, () => setPlayingId((current) => current === sound.id ? null : current));
    if (!started) setPlayingId(null);
  };

  useEffect(() => () => stopImageTaskSoundPlayback(), []);

  return (
    <section className="config-card sound-management-panel">
      <ConfigHeader title="提示音管理" desc="管理图片任务完成和失败时使用的全局提示音。仓库与发行包不包含音频文件。" />
      <div className="sound-management-toolbar">
        <div className="sound-management-summary">
          <strong className="sound-management-count"><span data-config-no-translate>{sounds.length}</span> 个提示音</strong>
          <span>音频保存在本地 data 目录，并随数据备份。</span>
        </div>
        <div className="sound-management-toolbar-actions">
          <a className="secondary-btn sound-source-link" href={sourceUrl} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={16} /> 前往 Mixkit 下载提示音
          </a>
          <label className="primary-btn sound-upload-button">
            <Upload size={16} /> 上传音频
            <input
              type="file"
              accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                event.currentTarget.value = "";
                if (!file) return;
                upload.reset();
                setUploadFile(file);
                setUploadName(file.name.replace(/\.[^.]+$/, ""));
              }}
            />
          </label>
        </div>
      </div>
      {soundsQuery.isLoading ? <div className="sound-management-state">提示音加载中...</div> : null}
      {soundsQuery.error ? <div className="form-error">{soundsQuery.error.message}</div> : null}
      {!soundsQuery.isLoading && !soundsQuery.error && sounds.length === 0 ? (
        <div className="sound-management-empty">
          <Volume2 size={28} aria-hidden="true" />
          <strong>暂未配置提示音</strong>
          <span>从素材网站下载有权使用的音频后，在这里上传即可。</span>
        </div>
      ) : null}
      {sounds.length > 0 ? (
        <div className="sound-management-list" role="table" aria-label="提示音列表">
          <div className="sound-management-list-head" role="row">
            <span role="columnheader">名称</span>
            <span role="columnheader">格式/大小</span>
            <span role="columnheader">状态</span>
            <span role="columnheader">操作</span>
          </div>
          {sounds.map((sound) => (
            <div className="sound-management-row" role="row" key={sound.id}>
              <div className="sound-management-name" role="cell">
                <button className="sound-preview-button" type="button" onClick={() => togglePreview(sound)} aria-label={playingId === sound.id ? `停止试听${sound.name}` : `试听${sound.name}`}>
                  {playingId === sound.id ? <Square size={15} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                </button>
                <div>
                  <strong title={sound.name}>{sound.name}</strong>
                  <span title={sound.originalFileName}>{sound.originalFileName}</span>
                </div>
              </div>
              <div className="sound-management-meta" role="cell">
                <strong>{sound.mimeType.replace("audio/", "").toUpperCase()}</strong>
                <span>{formatImageFileSize(sound.size)}</span>
              </div>
              <div role="cell">
                <SwitchControl
                  checked={sound.enabled}
                  disabled={update.isPending}
                  label={sound.enabled ? "已启用" : "已停用"}
                  onChange={(enabled) => update.mutate({ id: sound.id, patch: { enabled } })}
                />
              </div>
              <div className="sound-management-actions" role="cell">
                <button className="secondary-btn" type="button" onClick={() => setRenameTarget(sound)}>
                  <Pencil size={15} /> 改名
                </button>
                <button className="danger-btn" type="button" onClick={() => setDeleteTarget(sound)}>
                  <Trash2 size={15} /> 删除
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <UploadSoundDialog
        open={Boolean(uploadFile)}
        file={uploadFile}
        name={uploadName}
        pending={upload.isPending}
        error={upload.error instanceof Error ? upload.error.message : ""}
        onNameChange={setUploadName}
        onCancel={() => {
          if (upload.isPending) return;
          upload.reset();
          setUploadFile(null);
        }}
        onSubmit={() => upload.mutate()}
      />
      <PromptDialog
        open={Boolean(renameTarget)}
        title="修改提示音名称"
        label="名称"
        defaultValue={renameTarget?.name ?? ""}
        confirmText={update.isPending ? "保存中" : "保存"}
        onCancel={() => setRenameTarget(null)}
        onSubmit={(name) => {
          if (renameTarget && !update.isPending) update.mutate({ id: renameTarget.id, patch: { name: name.trim() } });
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除提示音"
        description={deleteTarget ? `确定删除“${deleteTarget.name}”吗？音频文件会从本地移除，使用该音频的用户将自动回退到其他可用提示音。` : ""}
        confirmText={remove.isPending ? "删除中" : "删除"}
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget && !remove.isPending) {
            if (playingId === deleteTarget.id) stopPreview();
            remove.mutate(deleteTarget.id);
          }
        }}
      />
    </section>
  );
}
