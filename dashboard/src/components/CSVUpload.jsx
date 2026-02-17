import { useState, useRef, useCallback } from 'react'
import Papa from 'papaparse'

const REQUIRED_COLUMNS = ['pattern', 'severity']
const OPTIONAL_COMPANY_COLUMNS = ['expires_at', 'company_name']

export default function CSVUpload({ type = 'location', onImport }) {
  const [file, setFile] = useState(null)
  const [parsedRows, setParsedRows] = useState([])
  const [parseErrors, setParseErrors] = useState([])
  const [validationErrors, setValidationErrors] = useState([])
  const [importing, setImporting] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const inputRef = useRef(null)

  const reset = () => {
    setFile(null)
    setParsedRows([])
    setParseErrors([])
    setValidationErrors([])
    if (inputRef.current) inputRef.current.value = ''
  }

  const validateRows = useCallback(
    (rows, headers) => {
      const errors = []

      // Check required columns
      for (const col of REQUIRED_COLUMNS) {
        if (!headers.includes(col)) {
          errors.push(`Missing required column: "${col}"`)
        }
      }
      if (errors.length > 0) return { validRows: [], errors }

      const validRows = []
      rows.forEach((row, idx) => {
        const rowNum = idx + 2 // 1-indexed + header row
        if (!row.pattern || !row.pattern.trim()) {
          errors.push(`Row ${rowNum}: pattern is empty`)
          return
        }
        if (!row.severity || !['red', 'amber'].includes(row.severity.trim().toLowerCase())) {
          errors.push(
            `Row ${rowNum}: severity must be "red" or "amber" (got "${row.severity || ''}")`,
          )
          return
        }

        const clean = {
          pattern: row.pattern.trim(),
          severity: row.severity.trim().toLowerCase(),
          message: (row.message || '').trim(),
        }

        if (type === 'company') {
          if (row.expires_at && row.expires_at.trim()) {
            const date = new Date(row.expires_at.trim())
            if (isNaN(date.getTime())) {
              errors.push(`Row ${rowNum}: invalid date in expires_at`)
              return
            }
            clean.expires_at = date.toISOString()
          }
          if (row.company_name) {
            clean.company_name = row.company_name.trim()
          }
        }

        validRows.push(clean)
      })

      return { validRows, errors }
    },
    [type],
  )

  const handleFile = useCallback(
    (selectedFile) => {
      if (!selectedFile) return
      if (!selectedFile.name.endsWith('.csv')) {
        setParseErrors(['Please select a CSV file.'])
        return
      }

      setFile(selectedFile)
      setParseErrors([])
      setValidationErrors([])
      setParsedRows([])

      Papa.parse(selectedFile, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors.length > 0) {
            setParseErrors(
              results.errors.map(
                (e) => `Row ${e.row != null ? e.row + 2 : '?'}: ${e.message}`,
              ),
            )
          }

          const headers = results.meta.fields || []
          const { validRows, errors } = validateRows(results.data, headers)
          setValidationErrors(errors)
          setParsedRows(validRows)
        },
        error: (err) => {
          setParseErrors([`Failed to parse CSV: ${err.message}`])
        },
      })
    },
    [validateRows],
  )

  const handleDrop = (e) => {
    e.preventDefault()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0])
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setDragActive(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setDragActive(false)
  }

  const handleImport = async () => {
    if (!parsedRows.length || !onImport) return
    setImporting(true)
    try {
      await onImport(parsedRows)
      reset()
    } catch {
      // Parent handles errors
    } finally {
      setImporting(false)
    }
  }

  const allErrors = [...parseErrors, ...validationErrors]

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          dragActive
            ? 'border-teal bg-teal/5'
            : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <div className="text-3xl mb-2">
          {file ? '\uD83D\uDCC4' : '\uD83D\uDCC1'}
        </div>
        {file ? (
          <p className="text-sm text-dark font-medium">{file.name}</p>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-2">
              Drag and drop a CSV file here, or
            </p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white hover:bg-teal-dark transition"
            >
              Choose File
            </button>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          onChange={(e) => handleFile(e.target.files?.[0])}
          className="hidden"
        />
        {file && (
          <button
            type="button"
            onClick={reset}
            className="mt-2 block mx-auto text-xs text-gray-400 hover:text-gray-600 transition"
          >
            Remove file
          </button>
        )}
      </div>

      {/* Expected format hint */}
      <div className="text-xs text-gray-400">
        <p className="font-medium text-gray-500 mb-1">
          Expected CSV columns:
        </p>
        <p>
          <span className="font-mono bg-gray-100 px-1 rounded">pattern</span>,{' '}
          <span className="font-mono bg-gray-100 px-1 rounded">severity</span>{' '}
          (red/amber),{' '}
          <span className="font-mono bg-gray-100 px-1 rounded">message</span>{' '}
          (optional)
          {type === 'company' && (
            <>
              ,{' '}
              <span className="font-mono bg-gray-100 px-1 rounded">
                expires_at
              </span>{' '}
              (optional),{' '}
              <span className="font-mono bg-gray-100 px-1 rounded">
                company_name
              </span>{' '}
              (optional)
            </>
          )}
        </p>
      </div>

      {/* Errors */}
      {allErrors.length > 0 && (
        <div className="rounded-lg bg-red/10 border border-red/20 px-4 py-3">
          <p className="text-sm font-medium text-red mb-1">
            {allErrors.length} issue{allErrors.length === 1 ? '' : 's'} found:
          </p>
          <ul className="text-xs text-red/80 space-y-0.5 max-h-32 overflow-y-auto">
            {allErrors.map((err, i) => (
              <li key={i}>- {err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Preview table */}
      {parsedRows.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-dark">
            Preview ({parsedRows.length} valid rule
            {parsedRows.length === 1 ? '' : 's'})
          </p>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-3 py-2 text-left font-semibold text-gray-500">
                    Pattern
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500">
                    Severity
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500">
                    Message
                  </th>
                  {type === 'company' && (
                    <th className="px-3 py-2 text-left font-semibold text-gray-500">
                      Expires
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {parsedRows.slice(0, 20).map((row, i) => (
                  <tr
                    key={i}
                    className={`border-b border-gray-100 ${
                      i % 2 === 1 ? 'bg-gray-50/40' : ''
                    }`}
                  >
                    <td className="px-3 py-2 font-mono text-dark">
                      {row.pattern}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium text-white ${
                          row.severity === 'red' ? 'bg-red' : 'bg-orange'
                        }`}
                      >
                        {row.severity}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600 max-w-xs truncate">
                      {row.message || '-'}
                    </td>
                    {type === 'company' && (
                      <td className="px-3 py-2 text-gray-600">
                        {row.expires_at
                          ? new Date(row.expires_at).toLocaleDateString()
                          : '-'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {parsedRows.length > 20 && (
              <p className="text-xs text-gray-400 px-3 py-2">
                ...and {parsedRows.length - 20} more
              </p>
            )}
          </div>

          {/* Import button */}
          <button
            type="button"
            onClick={handleImport}
            disabled={importing}
            className="rounded-lg bg-teal px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-dark focus:outline-none focus:ring-2 focus:ring-teal/40 disabled:opacity-60 disabled:cursor-not-allowed transition"
          >
            {importing
              ? 'Importing...'
              : `Import ${parsedRows.length} rule${parsedRows.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
    </div>
  )
}
