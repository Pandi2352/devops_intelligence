import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { FormField, SegmentedControl, TextArea, TextInput, Toggle } from '../common/Form';
import { ConnectorLogoTile } from './ConnectorLogos';
import { dnsApi, DnsRecord, DnsRecordInput, DnsRecordType, DnsZone } from '../../api/dnsApi';
import { getApiErrorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import {
  CONTENT_LABEL,
  CONTENT_PLACEHOLDER,
  PROXIABLE_TYPES,
  TTL_OPTIONS,
  fullName,
  relativeName,
  selectClass,
  ttlLabel,
  validateRecordContent,
  validateRecordName,
} from './dnsHelpers';

interface DnsRecordModalProps {
  connectorId: string;
  zone: DnsZone;
  record: DnsRecord | null;
  editableTypes: DnsRecordType[];
  onClose: () => void;
  onSaved: () => void;
}

type Errors = Partial<Record<'name' | 'content' | 'priority' | 'comment', string>>;

export const DnsRecordModal: React.FC<DnsRecordModalProps> = ({ connectorId, zone, record, editableTypes, onClose, onSaved }) => {
  const toast = useToast();
  const types = editableTypes.length ? editableTypes : (['A', 'AAAA', 'CNAME', 'TXT', 'MX'] as DnsRecordType[]);
  const [type, setType] = useState<DnsRecordType>((record?.type as DnsRecordType) || types[0]);
  const [name, setName] = useState(record ? relativeName(record.name, zone.name) : '');
  const [content, setContent] = useState(record?.content ?? '');
  const [proxied, setProxied] = useState(record ? record.proxied : true);
  const [ttl, setTtl] = useState(record?.ttl ?? 1);
  const [priority, setPriority] = useState(String(record?.priority ?? 10));
  const [comment, setComment] = useState(record?.comment ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const proxiable = PROXIABLE_TYPES.includes(type);
  const isProxied = proxiable && proxied;
  const ttlOptions = TTL_OPTIONS.some((o) => o.value === ttl) ? TTL_OPTIONS : [...TTL_OPTIONS, { value: ttl, label: ttlLabel(ttl) }];

  const validate = (): Errors => {
    const e: Errors = {};
    const n = validateRecordName(name);
    if (n) e.name = n;
    const c = validateRecordContent(type, content);
    if (c) e.content = c;
    if (type === 'MX') {
      const p = Number(priority);
      if (!/^\d+$/.test(priority.trim()) || p < 0 || p > 65535) e.priority = 'Priority is a number from 0 to 65535';
    }
    if (comment.length > 100) e.comment = 'Keep the comment under 100 characters';
    return e;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    const data: DnsRecordInput = {
      type,
      name: name.trim(),
      content: type === 'TXT' ? content : content.trim(),
      proxied: isProxied,
      ttl: isProxied ? 1 : ttl,
      comment: comment.trim(),
      ...(type === 'MX' ? { priority: Number(priority) } : {}),
    };
    setIsSaving(true);
    setFormError(null);
    try {
      const res = record ? await dnsApi.updateRecord(connectorId, zone.id, record.id, data) : await dnsApi.createRecord(connectorId, zone.id, data);
      toast.success(res.message || (record ? 'Record updated' : 'Record created'));
      onSaved();
    } catch (err) {
      setFormError(getApiErrorMessage(err, record ? 'Could not update the record' : 'Could not create the record'));
    } finally {
      setIsSaving(false);
    }
  };

  const clear = (key: keyof Errors) => setErrors((prev) => ({ ...prev, [key]: undefined }));

  return (
    <Modal
      isOpen
      onClose={onClose}
      preventClose={isSaving}
      maxWidth="md"
      icon={<ConnectorLogoTile kind="dns" />}
      title={record ? `Edit ${record.type} record` : 'Add DNS record'}
      subtitle={<span className="font-mono">{zone.name}</span>}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" form="dns-record-form" isLoading={isSaving}>
            {record ? 'Save record' : 'Add record'}
          </Button>
        </>
      }
    >
      <form id="dns-record-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        {record?.environment && (
          <div className="p-2.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs">
            This record is the public hostname of <strong className="font-semibold">{record.environment}</strong>. Changing it can break that
            environment's URL.
          </div>
        )}

        <div>
          <span className="block text-xs font-semibold text-slate-700 mb-1">Type</span>
          <SegmentedControl
            name="dns-record-type"
            value={type}
            options={types.map((t) => ({ value: t, label: t }))}
            onChange={(t) => {
              setType(t);
              clear('content');
            }}
          />
        </div>

        <FormField
          id="dns-record-name"
          label="Name"
          required
          error={errors.name}
          hint={
            <>
              Full name: <span className="font-mono text-slate-700">{fullName(name, zone.name)}</span>
            </>
          }
        >
          <TextInput
            id="dns-record-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clear('name');
            }}
            placeholder="@ for the zone root, www, or api.example.com"
            invalid={Boolean(errors.name)}
            mono
            spellCheck={false}
            autoComplete="off"
          />
        </FormField>

        <FormField
          id="dns-record-content"
          label={CONTENT_LABEL[type]}
          required
          error={errors.content}
          hint={type === 'TXT' ? `${content.length} / 2048 characters` : undefined}
        >
          {type === 'TXT' ? (
            <TextArea
              id="dns-record-content"
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                clear('content');
              }}
              placeholder={CONTENT_PLACEHOLDER.TXT}
              rows={3}
              maxLength={2048}
              invalid={Boolean(errors.content)}
              mono
            />
          ) : (
            <TextInput
              id="dns-record-content"
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                clear('content');
              }}
              placeholder={CONTENT_PLACEHOLDER[type]}
              invalid={Boolean(errors.content)}
              mono
              spellCheck={false}
              autoComplete="off"
            />
          )}
        </FormField>

        {proxiable && (
          <div className="p-3 rounded-md border border-orange-200 bg-orange-50/50">
            <Toggle
              id="dns-record-proxied"
              checked={proxied}
              onChange={setProxied}
              label="Proxied through Cloudflare"
              description="Orange cloud: traffic goes through Cloudflare (HTTPS, caching, DDoS protection) and hides your origin IP"
            />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField id="dns-record-ttl" label="TTL" hint={isProxied ? 'Proxied records always use Auto' : undefined}>
            <select
              id="dns-record-ttl"
              className={selectClass}
              value={isProxied ? 1 : ttl}
              onChange={(e) => setTtl(Number(e.target.value))}
              disabled={isProxied}
              title={isProxied ? 'Proxied records always use Auto' : undefined}
            >
              {ttlOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          {type === 'MX' && (
            <FormField id="dns-record-priority" label="Priority" required error={errors.priority} hint="Lower values are tried first">
              <TextInput
                id="dns-record-priority"
                type="number"
                min={0}
                max={65535}
                value={priority}
                onChange={(e) => {
                  setPriority(e.target.value);
                  clear('priority');
                }}
                placeholder="10"
                invalid={Boolean(errors.priority)}
              />
            </FormField>
          )}
        </div>

        <FormField id="dns-record-comment" label="Comment" error={errors.comment}>
          <TextInput
            id="dns-record-comment"
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              clear('comment');
            }}
            placeholder="Optional note, e.g. marketing site"
            maxLength={100}
            invalid={Boolean(errors.comment)}
          />
        </FormField>

        {formError && (
          <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
            {formError}
          </div>
        )}
      </form>
    </Modal>
  );
};
