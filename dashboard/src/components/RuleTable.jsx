import { useState, useMemo } from 'react'

function SortIcon({ direction }) {
  if (!direction) {
    return (
      <span className="text-gray-300 ml-1 inline-block w-3 text-xs">
        &#x25B4;&#x25BE;
      </span>
    )
  }
  return (
    <span className="text-teal ml-1 inline-block w-3 text-xs">
      {direction === 'asc' ? '\u25B4' : '\u25BE'}
    </span>
  )
}

function ToggleSwitch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-teal/40 ${
        checked ? 'bg-teal' : 'bg-gray-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export default function RuleTable({
  columns,
  data,
  onEdit,
  onDelete,
  onToggleActive,
  loading = false,
  emptyMessage = 'No data found.',
}) {
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc') // 'asc' | 'desc'
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [togglingId, setTogglingId] = useState(null)

  const handleSort = (key) => {
    if (!key) return
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortedData = useMemo(() => {
    if (!sortKey || !data) return data || []
    return [...data].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      if (typeof aVal === 'string') {
        const cmp = aVal.localeCompare(bVal, undefined, { sensitivity: 'base' })
        return sortDir === 'asc' ? cmp : -cmp
      }
      if (typeof aVal === 'boolean') {
        const cmp = aVal === bVal ? 0 : aVal ? -1 : 1
        return sortDir === 'asc' ? cmp : -cmp
      }
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [data, sortKey, sortDir])

  const handleDelete = async (id) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id)
      return
    }
    setDeletingId(id)
    try {
      await onDelete(id)
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  const handleToggle = async (row) => {
    setTogglingId(row.id)
    try {
      await onToggleActive(row.id, !row.is_active)
    } finally {
      setTogglingId(null)
    }
  }

  // Loading skeleton
  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="animate-pulse">
          <div className="h-12 bg-gray-50 border-b border-gray-100" />
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center gap-4 px-6 py-4 border-b border-gray-50"
            >
              <div className="h-4 w-1/4 bg-gray-200 rounded" />
              <div className="h-4 w-16 bg-gray-200 rounded" />
              <div className="h-4 w-1/3 bg-gray-200 rounded" />
              <div className="h-4 w-12 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Empty state
  if (!sortedData.length) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
        <p className="text-gray-400 text-sm">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortable !== false && handleSort(col.key)}
                  className={`px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider ${
                    col.sortable !== false
                      ? 'cursor-pointer select-none hover:text-navy'
                      : ''
                  }`}
                >
                  <span className="inline-flex items-center">
                    {col.label}
                    {col.sortable !== false && (
                      <SortIcon
                        direction={sortKey === col.key ? sortDir : null}
                      />
                    )}
                  </span>
                </th>
              ))}
              {/* Status column */}
              {onToggleActive && (
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              )}
              {/* Actions column */}
              {(onEdit || onDelete) && (
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedData.map((row, idx) => (
              <tr
                key={row.id}
                className={`border-b border-gray-50 hover:bg-light/50 transition-colors ${
                  idx % 2 === 1 ? 'bg-gray-50/30' : ''
                }`}
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-6 py-3.5">
                    {col.render ? col.render(row[col.key], row) : row[col.key]}
                  </td>
                ))}

                {/* Status toggle */}
                {onToggleActive && (
                  <td className="px-6 py-3.5">
                    <ToggleSwitch
                      checked={!!row.is_active}
                      onChange={() => handleToggle(row)}
                      disabled={togglingId === row.id}
                    />
                  </td>
                )}

                {/* Actions */}
                {(onEdit || onDelete) && (
                  <td className="px-6 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {onEdit && (
                        <button
                          onClick={() => onEdit(row)}
                          className="text-xs font-medium text-teal hover:text-teal-dark transition px-2 py-1 rounded hover:bg-teal/5"
                        >
                          Edit
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => handleDelete(row.id)}
                          disabled={deletingId === row.id}
                          className={`text-xs font-medium transition px-2 py-1 rounded ${
                            confirmDeleteId === row.id
                              ? 'text-white bg-red hover:bg-red/90'
                              : 'text-red hover:text-red/80 hover:bg-red/5'
                          } disabled:opacity-50`}
                        >
                          {deletingId === row.id
                            ? '...'
                            : confirmDeleteId === row.id
                              ? 'Confirm'
                              : 'Delete'}
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
