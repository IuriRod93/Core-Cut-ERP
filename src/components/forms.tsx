import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { Stack } from './Stack'
import { CloseIcon } from './icons'
import { useToast } from './feedback'
import { useCollection } from '../lib/store'
import { PhotoField } from './PhotoField'
import { relationHint, relationLabel } from '../domain/labels'
import { maskDocument, maskPhone, num } from '../lib/format'
import type { Opt } from '../domain/constants'
import type { CollectionName } from '../types'

export type Values = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export interface FieldDef {
  name: string
  label: string
  type:
    | 'text'
    | 'textarea'
    | 'number'
    | 'money'
    | 'percent'
    | 'date'
    | 'time'
    | 'select'
    | 'relation'
    | 'relations'
    | 'switch'
    | 'tags'
    | 'phone'
    | 'document'
    | 'email'
    | 'password'
    | 'color'
    | 'image'
  options?: Opt[]
  collection?: CollectionName
  filter?: (doc: any) => boolean // eslint-disable-line @typescript-eslint/no-explicit-any
  required?: boolean
  span?: number
  helper?: string
  placeholder?: string
  min?: number
  max?: number
  step?: number
  rows?: number
  adornment?: string
  disabled?: boolean | ((values: Values) => boolean)
  show?: (values: Values) => boolean
  section?: string
}

// ------------------------------------------------------------ NumberField
export function NumberField({
  value,
  onChange,
  label,
  adornment,
  min,
  max,
  step,
  size = 'small',
  placeholder,
  disabled,
  decimals,
  error,
  helperText,
  required,
  fullWidth = true,
  sx,
}: {
  value: number | string | null | undefined
  onChange: (v: number | null) => void
  label?: string
  adornment?: string
  min?: number
  max?: number
  step?: number
  size?: 'small' | 'medium'
  placeholder?: string
  disabled?: boolean
  decimals?: number
  error?: boolean
  helperText?: string
  required?: boolean
  fullWidth?: boolean
  sx?: object
}) {
  const [text, setText] = useState<string>(value === null || value === undefined || value === '' ? '' : String(value).replace('.', ','))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (focused) return
    setText(value === null || value === undefined || value === '' ? '' : String(value).replace('.', ','))
  }, [value, focused])

  return (
    <TextField
      size={size}
      label={label}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      error={error}
      helperText={helperText}
      required={required}
      fullWidth={fullWidth}
      sx={sx}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        if (text === '') return
        let n = num(text)
        if (min !== undefined) n = Math.max(min, n)
        if (max !== undefined) n = Math.min(max, n)
        if (decimals !== undefined) n = Math.round(n * 10 ** decimals) / 10 ** decimals
        setText(String(n).replace('.', ','))
        onChange(n)
      }}
      onChange={(e) => {
        const raw = e.target.value
        if (!/^-?\d*[,.]?\d*$/.test(raw)) return
        setText(raw)
        if (raw === '' || raw === '-') onChange(null)
        else if (!/[,.]$/.test(raw)) onChange(num(raw))
      }}
      slotProps={{
        htmlInput: { inputMode: 'decimal', step, style: { fontVariantNumeric: 'tabular-nums' } },
        input: adornment ? { startAdornment: <InputAdornment position="start">{adornment}</InputAdornment> } : undefined,
      }}
    />
  )
}

// ---------------------------------------------------------- RelationSelect
export function useRelationOptions(collection: CollectionName, filter?: (doc: any) => boolean) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { items } = useCollection(collection)
  return useMemo(
    () =>
      (items as any[]) // eslint-disable-line @typescript-eslint/no-explicit-any
        .filter((d) => (filter ? filter(d) : d.active !== false))
        .map((d) => ({ id: d.id as string, label: relationLabel(collection, d), hint: relationHint(collection, d) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    [items, collection, filter],
  )
}

export function RelationSelect({
  collection,
  value,
  onChange,
  label,
  filter,
  required,
  error,
  helperText,
  disabled,
  placeholder,
  size = 'small',
}: {
  collection: CollectionName
  value: string | null | undefined
  onChange: (id: string | null) => void
  label?: string
  filter?: (doc: any) => boolean // eslint-disable-line @typescript-eslint/no-explicit-any
  required?: boolean
  error?: boolean
  helperText?: string
  disabled?: boolean
  placeholder?: string
  size?: 'small' | 'medium'
}) {
  const options = useRelationOptions(collection, filter)
  const selected = options.find((o) => o.id === value) ?? null
  return (
    <Autocomplete
      size={size}
      options={options}
      value={selected}
      disabled={disabled}
      onChange={(_, v) => onChange(v?.id ?? null)}
      getOptionLabel={(o) => o.label}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      noOptionsText="Nenhum registro encontrado"
      clearText="Limpar"
      openText="Abrir"
      closeText="Fechar"
      renderOption={(props, o) => (
        <li {...props} key={o.id}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {o.label}
            </Typography>
            {o.hint ? (
              <Typography variant="caption" color="text.secondary" noWrap>
                {o.hint}
              </Typography>
            ) : null}
          </Box>
        </li>
      )}
      renderInput={(params) => <TextField {...params} label={label} required={required} error={error} helperText={helperText} placeholder={placeholder} />}
    />
  )
}

export function RelationMultiSelect({
  collection,
  value,
  onChange,
  label,
  filter,
  placeholder,
  size = 'small',
}: {
  collection: CollectionName
  value: string[] | undefined
  onChange: (ids: string[]) => void
  label?: string
  filter?: (doc: any) => boolean // eslint-disable-line @typescript-eslint/no-explicit-any
  placeholder?: string
  size?: 'small' | 'medium'
}) {
  const options = useRelationOptions(collection, filter)
  const selected = options.filter((o) => (value ?? []).includes(o.id))
  return (
    <Autocomplete
      multiple
      size={size}
      options={options}
      value={selected}
      onChange={(_, v) => onChange(v.map((o) => o.id))}
      getOptionLabel={(o) => o.label}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterSelectedOptions
      noOptionsText="Nenhum registro encontrado"
      renderValue={(vals, getItemProps) =>
        vals.map((o, index) => {
          const { key, ...rest } = getItemProps({ index })
          return <Chip key={key} size="small" label={o.label} {...rest} />
        })
      }
      renderInput={(params) => <TextField {...params} label={label} placeholder={selected.length ? '' : placeholder} />}
    />
  )
}

export function TagsInput({ value, onChange, label, placeholder }: { value: string[] | undefined; onChange: (v: string[]) => void; label?: string; placeholder?: string }) {
  return (
    <Autocomplete
      multiple
      freeSolo
      size="small"
      options={[] as string[]}
      value={value ?? []}
      onChange={(_, v) => onChange(v.map((t) => String(t).trim()).filter(Boolean))}
      renderValue={(vals, getItemProps) =>
        vals.map((t, index) => {
          const { key, ...rest } = getItemProps({ index })
          return <Chip key={key} size="small" label={t} {...rest} />
        })
      }
      renderInput={(params) => <TextField {...params} label={label} placeholder={placeholder ?? 'Digite e pressione Enter'} />}
    />
  )
}

// ------------------------------------------------------------ FieldRenderer
export function FieldRenderer({
  field,
  values,
  onChange,
  error,
}: {
  field: FieldDef
  values: Values
  onChange: (name: string, value: unknown) => void
  error?: string
}) {
  const value = values[field.name]
  const disabled = typeof field.disabled === 'function' ? field.disabled(values) : field.disabled
  const common = { label: field.label, required: field.required, error: Boolean(error), helperText: error ?? field.helper, disabled }

  switch (field.type) {
    case 'textarea':
      return (
        <TextField
          {...common}
          value={value ?? ''}
          multiline
          minRows={field.rows ?? 3}
          maxRows={10}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.name, e.target.value)}
        />
      )
    case 'number':
    case 'money':
    case 'percent':
      return (
        <NumberField
          label={field.label}
          required={field.required}
          error={Boolean(error)}
          helperText={error ?? field.helper}
          disabled={disabled}
          value={value}
          adornment={field.adornment ?? (field.type === 'money' ? 'R$' : undefined)}
          min={field.min ?? (field.type === 'percent' ? 0 : undefined)}
          max={field.max ?? (field.type === 'percent' ? 100 : undefined)}
          decimals={field.type === 'money' ? 2 : undefined}
          onChange={(v) => onChange(field.name, v)}
        />
      )
    case 'date':
    case 'time':
      return (
        <TextField
          {...common}
          type={field.type}
          value={value ?? ''}
          onChange={(e) => onChange(field.name, e.target.value || null)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      )
    case 'select':
      return (
        <TextField {...common} select value={value ?? ''} onChange={(e) => onChange(field.name, e.target.value)}>
          {!field.required ? (
            <MenuItem value="">
              <Box component="span" sx={{ color: 'text.disabled' }}>
                — não informado —
              </Box>
            </MenuItem>
          ) : null}
          {(field.options ?? []).map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
      )
    case 'relation':
      return (
        <RelationSelect
          collection={field.collection!}
          filter={field.filter}
          value={value}
          onChange={(id) => onChange(field.name, id)}
          label={field.label}
          required={field.required}
          error={Boolean(error)}
          helperText={error ?? field.helper}
          disabled={disabled}
        />
      )
    case 'relations':
      return (
        <RelationMultiSelect collection={field.collection!} filter={field.filter} value={value} onChange={(ids) => onChange(field.name, ids)} label={field.label} />
      )
    case 'switch':
      return (
        <FormControlLabel
          control={<Switch checked={Boolean(value)} onChange={(e) => onChange(field.name, e.target.checked)} disabled={disabled} />}
          label={field.label}
        />
      )
    case 'tags':
      return <TagsInput value={value} onChange={(v) => onChange(field.name, v)} label={field.label} />
    case 'phone':
      return <TextField {...common} value={value ?? ''} placeholder="(00) 00000-0000" onChange={(e) => onChange(field.name, maskPhone(e.target.value))} />
    case 'document':
      return <TextField {...common} value={value ?? ''} placeholder="CPF ou CNPJ" onChange={(e) => onChange(field.name, maskDocument(e.target.value))} />
    case 'email':
      return <TextField {...common} type="email" value={value ?? ''} onChange={(e) => onChange(field.name, e.target.value)} />
    case 'password':
      return (
        <TextField {...common} type="password" autoComplete="new-password" value={value ?? ''} onChange={(e) => onChange(field.name, e.target.value)} />
      )
    case 'image':
      return <PhotoField value={value} onChange={(id) => onChange(field.name, id)} label={field.label} fallbackUrl={typeof field.placeholder === 'string' ? field.placeholder : undefined} />
    case 'color':
      return (
        <TextField
          {...common}
          type="color"
          value={value || '#700618'}
          onChange={(e) => onChange(field.name, e.target.value)}
          sx={{ '& input': { height: 22, p: 0.5 } }}
        />
      )
    default:
      return (
        <TextField
          {...common}
          value={value ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.name, e.target.value)}
          slotProps={field.adornment ? { input: { startAdornment: <InputAdornment position="start">{field.adornment}</InputAdornment> } } : undefined}
        />
      )
  }
}

// ----------------------------------------------------------------- DocForm
export function DocForm({
  fields,
  values,
  onChange,
  errors = {},
}: {
  fields: FieldDef[]
  values: Values
  onChange: (name: string, value: unknown) => void
  errors?: Record<string, string>
}) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 2, alignItems: 'start' }}>
      {fields.map((f) => {
        if (f.show && !f.show(values)) return null
        const span = f.span ?? (f.type === 'textarea' || f.type === 'tags' || f.type === 'relations' ? 12 : 6)
        return (
          <Box key={f.name} sx={{ gridColumn: { xs: 'span 12', sm: `span ${span}` } }}>
            {f.section ? (
              <Typography variant="overline" color="primary" sx={{ display: 'block', mb: 1, mt: 0.5 }}>
                {f.section}
              </Typography>
            ) : null}
            <FieldRenderer field={f} values={values} onChange={onChange} error={errors[f.name]} />
          </Box>
        )
      })}
    </Box>
  )
}

// -------------------------------------------------------------- FormDialog
export function validateFields(fields: FieldDef[], values: Values) {
  const errors: Record<string, string> = {}
  for (const f of fields) {
    if (f.show && !f.show(values)) continue
    const v = values[f.name]
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
    if (f.required && empty) errors[f.name] = 'Campo obrigatório'
    if (f.type === 'email' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) errors[f.name] = 'E-mail inválido'
  }
  return errors
}

export function FormDialog({
  open,
  title,
  subtitle,
  fields,
  initial,
  onClose,
  onSave,
  onFieldChange,
  saveLabel = 'Salvar',
  maxWidth = 'md',
  children,
  extraActions,
}: {
  open: boolean
  title: ReactNode
  subtitle?: ReactNode
  fields: FieldDef[]
  initial: Values
  onClose: () => void
  onSave: (values: Values) => Promise<unknown> | unknown
  onFieldChange?: (name: string, value: unknown, values: Values) => Record<string, unknown> | void
  saveLabel?: string
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg'
  children?: (ctx: { values: Values; set: (name: string, value: unknown) => void }) => ReactNode
  extraActions?: ReactNode
}) {
  const toast = useToast()
  const [values, setValues] = useState<Values>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setValues(initial)
      setErrors({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = (name: string, value: unknown) => {
    setValues((v) => ({ ...v, [name]: value, ...(onFieldChange?.(name, value, v) ?? {}) }))
    setErrors((e) => {
      if (!e[name]) return e
      const { [name]: _removed, ...rest } = e
      return rest
    })
  }

  const submit = async () => {
    const found = validateFields(fields, values)
    setErrors(found)
    if (Object.keys(found).length) {
      toast.error('Corrija os campos destacados.')
      return
    }
    setSaving(true)
    try {
      await onSave(values)
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth={maxWidth} scroll="paper">
      <DialogTitle>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            {title}
            {subtitle ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'inherit' }}>
                {subtitle}
              </Typography>
            ) : null}
          </Box>
          <IconButton onClick={onClose} size="small" aria-label="Fechar" disabled={saving}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers={false}>
        <Box sx={{ pt: 1 }}>
          <DocForm fields={fields} values={values} onChange={set} errors={errors} />
          {children ? <Box sx={{ mt: 2 }}>{children({ values, set })}</Box> : null}
        </Box>
      </DialogContent>
      <DialogActions>
        {extraActions}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} color="inherit" disabled={saving}>
          Cancelar
        </Button>
        <Button onClick={submit} variant="contained" disabled={saving}>
          {saving ? 'Salvando…' : saveLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
