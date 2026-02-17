import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import RuleTable from '../components/RuleTable'
import RuleForm from '../components/RuleForm'
import CSVUpload from '../components/CSVUpload'

const COLUMNS = [
  {
    key: 'pattern',
    label: 'Pattern',
    sortable: true,
    render: (val) => (
      <span className="font-mono text-sm text-dark">{val}</span>
    ),
  },
  {
    key: 'severity',
    label: 'Severity',
    sortable: true,
    render: (val) => (
      <span
        className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold text-white ${
          val === 'red' ? 'bg-red' : 'bg-orange'
        }`}
      >
        {val}
      </span>
    ),
  },
  {
    key: 'message',
    label: 'Message',
    sortable: false,
    render: (val) => (
      <span className="text-gray-600 text-sm max-w-xs truncate block">
        {val || '-'}
      </span>
    ),
  },
]

export default function LocationRules() {
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingRule, setEditingRule] = useState(null)
  const [showCSV, setShowCSV] = useState(false)

  const fetchRules = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: fetchErr } = await supabase
        .from('location_rules')
        .select('*')
        .order('created_at', { ascending: false })

      if (fetchErr) throw fetchErr
      setRules(data || [])
    } catch (err) {
      setError('Failed to load location rules. Please try again.')
      console.error('LocationRules fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRules()
  }, [fetchRules])

  const handleAdd = async (values) => {
    setError('')
    // Optimistic: add to list
    const tempId = `temp-${Date.now()}`
    const optimistic = { id: tempId, ...values, is_active: true }
    setRules((prev) => [optimistic, ...prev])
    setShowForm(false)

    try {
      const { data, error: insertErr } = await supabase
        .from('location_rules')
        .insert([{ ...values, is_active: true }])
        .select()
        .single()

      if (insertErr) throw insertErr

      // Replace optimistic entry with real one
      setRules((prev) =>
        prev.map((r) => (r.id === tempId ? data : r)),
      )
    } catch (err) {
      // Rollback
      setRules((prev) => prev.filter((r) => r.id !== tempId))
      setError('Failed to add rule. Please try again.')
      console.error('Add rule error:', err)
    }
  }

  const handleEdit = async (values) => {
    if (!editingRule) return
    setError('')

    const originalRule = { ...editingRule }
    // Optimistic update
    setRules((prev) =>
      prev.map((r) => (r.id === editingRule.id ? { ...r, ...values } : r)),
    )
    setEditingRule(null)
    setShowForm(false)

    try {
      const { error: updateErr } = await supabase
        .from('location_rules')
        .update(values)
        .eq('id', originalRule.id)

      if (updateErr) throw updateErr
    } catch (err) {
      // Rollback
      setRules((prev) =>
        prev.map((r) => (r.id === originalRule.id ? originalRule : r)),
      )
      setError('Failed to update rule. Please try again.')
      console.error('Update rule error:', err)
    }
  }

  const handleDelete = async (id) => {
    setError('')
    const deletedRule = rules.find((r) => r.id === id)
    // Optimistic remove
    setRules((prev) => prev.filter((r) => r.id !== id))

    try {
      const { error: deleteErr } = await supabase
        .from('location_rules')
        .delete()
        .eq('id', id)

      if (deleteErr) throw deleteErr
    } catch (err) {
      // Rollback
      if (deletedRule) {
        setRules((prev) => [deletedRule, ...prev])
      }
      setError('Failed to delete rule. Please try again.')
      console.error('Delete rule error:', err)
    }
  }

  const handleToggleActive = async (id, newStatus) => {
    setError('')
    // Optimistic
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, is_active: newStatus } : r)),
    )

    try {
      const { error: toggleErr } = await supabase
        .from('location_rules')
        .update({ is_active: newStatus })
        .eq('id', id)

      if (toggleErr) throw toggleErr
    } catch (err) {
      // Rollback
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, is_active: !newStatus } : r)),
      )
      setError('Failed to update rule status. Please try again.')
      console.error('Toggle active error:', err)
    }
  }

  const handleCSVImport = async (rows) => {
    setError('')
    try {
      const toInsert = rows.map((row) => ({
        ...row,
        is_active: true,
      }))

      const { data, error: insertErr } = await supabase
        .from('location_rules')
        .insert(toInsert)
        .select()

      if (insertErr) throw insertErr
      setRules((prev) => [...(data || []), ...prev])
      setShowCSV(false)
    } catch (err) {
      setError('Failed to import rules. Please try again.')
      console.error('CSV import error:', err)
      throw err // re-throw so CSVUpload knows import failed
    }
  }

  const openEdit = (rule) => {
    setEditingRule(rule)
    setShowForm(true)
    setShowCSV(false)
  }

  const openAdd = () => {
    setEditingRule(null)
    setShowForm(true)
    setShowCSV(false)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingRule(null)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Location Rules</h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage URL patterns that trigger warnings or blocks
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setShowCSV(!showCSV)
              setShowForm(false)
            }}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition"
          >
            {showCSV ? 'Close Import' : 'Import CSV'}
          </button>
          <button
            onClick={openAdd}
            className="rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-dark transition"
          >
            Add Rule
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 rounded-lg bg-red/10 border border-red/20 px-4 py-3 text-sm text-red flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError('')}
            className="text-red/60 hover:text-red ml-4 text-lg leading-none"
          >
            &times;
          </button>
        </div>
      )}

      {/* CSV Upload */}
      {showCSV && (
        <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-navy mb-4">
            Import Location Rules from CSV
          </h2>
          <CSVUpload type="location" onImport={handleCSVImport} />
        </div>
      )}

      {/* Add / Edit Form */}
      {showForm && (
        <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-navy mb-4">
            {editingRule ? 'Edit Rule' : 'Add New Rule'}
          </h2>
          <RuleForm
            type="location"
            initialValues={editingRule}
            onSubmit={editingRule ? handleEdit : handleAdd}
            onCancel={closeForm}
          />
        </div>
      )}

      {/* Table */}
      <RuleTable
        columns={COLUMNS}
        data={rules}
        loading={loading}
        onEdit={openEdit}
        onDelete={handleDelete}
        onToggleActive={handleToggleActive}
        emptyMessage="No location rules configured. Add your first rule to get started."
      />
    </div>
  )
}
