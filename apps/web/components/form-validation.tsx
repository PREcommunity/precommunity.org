'use client';

import { type FormEvent, useId, useState } from 'react';

type FormErrors = Record<string, string>;
type ValidatedField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

type SupportedValidity = Pick<
  ValidityState,
  'valid' | 'valueMissing' | 'patternMismatch' | 'typeMismatch' | 'tooShort' | 'tooLong'
>;

const fieldLabels: Record<string, string> = {
  name: 'name or title',
  title: 'title',
  category: 'category',
  description: 'description',
  body: 'response',
  purpose: 'on-chain purpose',
  slug: 'internal slug',
  deadline: 'deadline',
  firstSettlementAt: 'first settlement date',
  monthlySurplusPolicy: 'monthly surplus policy',
  recipientAddress: 'recipient address',
  pre: 'PRE target',
  usdc: 'USDC target',
  metadataUri: 'IPFS metadata URI',
  keyword: 'search phrase',
  destinationUrl: 'HTTPS destination',
  discussionUrl: 'discussion URL',
  websiteUrl: 'public URL',
  displayName: 'display name',
  avatarUri: 'avatar IPFS URI',
};

export function validationMessageFor(
  name: string,
  validity: SupportedValidity,
  nativeMessage = '',
  limits: { minLength?: number; maxLength?: number } = {},
) {
  if (validity.valid) return '';
  const label = fieldLabels[name] ?? 'field';
  if (validity.valueMissing) return `Enter the ${label}.`;
  if (validity.tooShort && limits.minLength && limits.minLength > 0) {
    return `Use at least ${limits.minLength} characters for the ${label}.`;
  }
  if (validity.tooLong && limits.maxLength && limits.maxLength > 0) {
    return `Use at most ${limits.maxLength} characters for the ${label}.`;
  }
  if (validity.patternMismatch) {
    if (name === 'slug') {
      return 'Use lowercase letters, numbers and hyphens only, for example payout-with-surplus.';
    }
    if (name === 'recipientAddress') return 'Enter a valid Ethereum address beginning with 0x.';
    if (name === 'metadataUri' || name === 'avatarUri') {
      return 'Enter a valid IPFS URI beginning with ipfs://.';
    }
    if (name === 'pre' || name === 'usdc') return 'Enter a non-negative decimal number.';
    if (name === 'destinationUrl') return 'Enter a complete HTTPS URL.';
    if (name === 'websiteUrl') return 'Enter a complete HTTPS URL.';
  }
  if (validity.typeMismatch && (name === 'destinationUrl' || name === 'websiteUrl')) {
    return 'Enter a complete URL beginning with https://.';
  }
  if (validity.typeMismatch && name === 'discussionUrl') {
    return 'Enter a complete URL beginning with http:// or https://.';
  }
  if (validity.typeMismatch) return `Enter a valid ${label}.`;
  return nativeMessage || 'Correct this field before continuing.';
}

function validatedField(target: EventTarget): ValidatedField | null {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return target;
  }
  return null;
}

function messageForField(field: ValidatedField) {
  return validationMessageFor(field.name, field.validity, field.validationMessage, {
    minLength: 'minLength' in field ? field.minLength : undefined,
    maxLength: 'maxLength' in field ? field.maxLength : undefined,
  });
}

function fieldKey(field: ValidatedField) {
  return field.dataset.validationKey || field.name;
}

export function useFormValidation() {
  const [errors, setErrors] = useState<FormErrors>({});
  const prefix = useId().replaceAll(':', '');

  function onInvalid(event: FormEvent<HTMLFormElement>) {
    const field = validatedField(event.target);
    if (!field?.name) return;
    setErrors((current) => ({ ...current, [fieldKey(field)]: messageForField(field) }));
  }

  function onInput(event: FormEvent<HTMLFormElement>) {
    const field = validatedField(event.target);
    if (!field?.name) return;
    const key = fieldKey(field);
    setErrors((current) => {
      if (!(key in current)) return current;
      const message = messageForField(field);
      if (message) return { ...current, [key]: message };
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function errorId(name: string) {
    return `${prefix}-${name}-error`;
  }

  return {
    errors,
    onInvalid,
    onInput,
    reset: () => setErrors({}),
    fieldProps: (name: string, key = name) => ({
      'aria-describedby': errors[key] ? errorId(key) : undefined,
      'aria-invalid': Boolean(errors[key]),
      'data-validation-key': key === name ? undefined : key,
    }),
    errorProps: (name: string) => ({ id: errorId(name), message: errors[name] }),
  };
}

export function FormFieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <small className="text-[11px] leading-4 text-danger" id={id} role="alert">
      {message}
    </small>
  );
}
