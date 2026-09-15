import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { CameraIcon, CheckIcon, DocumentIcon, PlusIcon } from '@/components/Icons';
import { Card, Chip, EmptyState, FormRow, Sheet } from '@/components/ui';
import { api, getAccessToken, getBaseUrl } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';

interface TenantDocument {
  id: string;
  fileName: string;
  mimeType: string;
  uploadedAt: string;
  verification: string;
  documentType: { id: string; name: string };
}

interface DocumentType {
  id: string;
  name: string;
  required: boolean;
}

/**
 * Tenant documents: pick a file, capture with the camera, or sign on screen.
 * Uploads go through multipart so the backend controls where files land.
 */
export function DocumentsPanel({
  tenantId,
  documents,
}: {
  tenantId: string;
  documents: TenantDocument[];
}) {
  const can = useAuthStore((s) => s.can);
  const toast = useUiStore((s) => s.toast);
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [documentTypeId, setDocumentTypeId] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: types } = useQuery({
    queryKey: ['document-types'],
    queryFn: () => api.get<DocumentType[]>('/document-types'),
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  /** Multipart upload — the JSON client cannot carry a file body. */
  const upload = async (blob: Blob, fileName: string): Promise<void> => {
    if (!documentTypeId) {
      toast('Choose a document type first', 'error');
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', blob, fileName);
      form.append('documentTypeId', documentTypeId);

      const base = await getBaseUrl();
      const response = await fetch(`${base}/tenants/${tenantId}/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        body: form,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Upload failed');
      }
      toast('Document uploaded', 'success');
      refresh();
      setUploadOpen(false);
      setSignatureOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Upload failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const capturePhoto = async (): Promise<void> => {
    try {
      const photo = await Camera.getPhoto({
        quality: 78,
        resultType: CameraResultType.Base64,
        source: CameraSource.Prompt,
        // Large originals make the APK's storage folder grow fast.
        width: 1800,
        correctOrientation: true,
      });
      if (!photo.base64String) return;
      const blob = base64ToBlob(photo.base64String, `image/${photo.format}`);
      await upload(blob, `capture.${photo.format}`);
    } catch {
      // The user cancelled the picker; nothing to report.
    }
  };

  const verify = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.post(`/documents/${id}/verify`, { status }),
    onSuccess: () => {
      toast('Document updated', 'success');
      refresh();
    },
  });

  const missingRequired = (types ?? []).filter(
    (t) => t.required && !documents.some((d) => d.documentType.id === t.id),
  );

  return (
    <div className="space-y-4">
      {can('document.manage') && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => setUploadOpen(true)}>
            <PlusIcon size={18} />
            Add document
          </button>
          <button type="button" className="btn-secondary" onClick={() => setSignatureOpen(true)}>
            Capture signature
          </button>
        </div>
      )}

      {missingRequired.length > 0 && (
        <Card className="p-3.5 border-caution/40 bg-caution/8">
          <p className="text-sm">
            <span className="font-medium text-caution">Still required: </span>
            {missingRequired.map((t) => t.name).join(', ')}
          </p>
        </Card>
      )}

      {documents.length === 0 ? (
        <EmptyState
          icon={<DocumentIcon size={30} />}
          title="No documents yet"
          message="Aadhaar, office ID, offer letter, signature and anything else you configure."
        />
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <Card key={doc.id} className="p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{doc.documentType.name}</p>
                  <p className="text-xs text-ink-muted truncate">{doc.fileName}</p>
                  <p className="text-xs text-ink-faint mt-0.5">
                    Uploaded {formatDate(doc.uploadedAt)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <Chip
                    tone={
                      doc.verification === 'VERIFIED'
                        ? 'positive'
                        : doc.verification === 'REJECTED'
                          ? 'critical'
                          : 'caution'
                    }
                  >
                    {doc.verification.toLowerCase()}
                  </Chip>
                  {can('document.verify') && doc.verification !== 'VERIFIED' && (
                    <button
                      type="button"
                      className="btn-ghost !min-h-0 h-9 px-2.5 text-sm"
                      onClick={() => verify.mutate({ id: doc.id, status: 'VERIFIED' })}
                    >
                      <CheckIcon size={16} />
                      Verify
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Sheet
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Add document"
        footer={
          <button type="button" className="btn-secondary" onClick={() => setUploadOpen(false)}>
            Close
          </button>
        }
      >
        <FormRow label="Document type">
          <select
            className="input"
            value={documentTypeId}
            onChange={(e) => setDocumentTypeId(e.target.value)}
          >
            <option value="">Choose…</option>
            {types?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.required ? ' (required)' : ''}
              </option>
            ))}
          </select>
        </FormRow>

        <div className="flex flex-col gap-2.5 mt-5">
          <button
            type="button"
            className="btn-secondary"
            disabled={!documentTypeId || busy}
            onClick={() =>
              Capacitor.isNativePlatform() ? void capturePhoto() : fileInput.current?.click()
            }
          >
            <CameraIcon size={18} />
            {Capacitor.isNativePlatform() ? 'Camera or gallery' : 'Choose a file'}
          </button>

          {Capacitor.isNativePlatform() && (
            <button
              type="button"
              className="btn-ghost"
              disabled={!documentTypeId || busy}
              onClick={() => fileInput.current?.click()}
            >
              Choose a file instead
            </button>
          )}
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file, file.name);
            e.target.value = '';
          }}
        />

        {busy && <p className="text-sm text-ink-muted mt-3">Uploading…</p>}
      </Sheet>

      <SignatureSheet
        open={signatureOpen}
        onClose={() => setSignatureOpen(false)}
        types={types ?? []}
        documentTypeId={documentTypeId}
        setDocumentTypeId={setDocumentTypeId}
        onSave={(blob) => upload(blob, 'signature.png')}
        busy={busy}
      />
    </div>
  );
}

/** On-screen signature capture — a canvas the tenant signs with a finger. */
function SignatureSheet({
  open,
  onClose,
  types,
  documentTypeId,
  setDocumentTypeId,
  onSave,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  types: DocumentType[];
  documentTypeId: string;
  setDocumentTypeId: (id: string) => void;
  onSave: (blob: Blob) => Promise<void>;
  busy: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const position = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    // The canvas backing store is larger than its CSS box, so scale the point.
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = position(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawing.current = true;
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = position(event);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111111';
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasInk(true);
  };

  const clear = (): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Capture signature"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={clear}>
            Clear
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!hasInk || !documentTypeId || busy}
            onClick={() => {
              canvasRef.current?.toBlob((blob) => {
                if (blob) void onSave(blob);
              }, 'image/png');
            }}
          >
            {busy ? 'Saving…' : 'Save signature'}
          </button>
        </>
      }
    >
      <FormRow label="Save as">
        <select
          className="input"
          value={documentTypeId}
          onChange={(e) => setDocumentTypeId(e.target.value)}
        >
          <option value="">Choose…</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </FormRow>

      <p className="text-sm text-ink-muted mb-2">Sign inside the box below.</p>
      <canvas
        ref={(node) => {
          canvasRef.current = node;
          if (node && !hasInk) {
            const ctx = node.getContext('2d')!;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, node.width, node.height);
          }
        }}
        width={900}
        height={320}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={() => (drawing.current = false)}
        onPointerCancel={() => (drawing.current = false)}
        className="w-full rounded-lg border border-line bg-white touch-none"
        style={{ aspectRatio: '900 / 320' }}
      />
    </Sheet>
  );
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
