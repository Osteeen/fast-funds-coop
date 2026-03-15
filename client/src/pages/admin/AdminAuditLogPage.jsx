import React, { useEffect, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import PageHeader from '../../components/common/PageHeader'
import LoadingSpinner from '../../components/common/LoadingSpinner'
import EmptyState from '../../components/common/EmptyState'
import api, { formatDateTime } from '../../utils/api'
import { HiClipboardList } from 'react-icons/hi'

const actionColors = {
  'loan.approved':        'bg-green-100 text-green-700',
  'loan.declined':        'bg-red-100 text-red-700',
  'loan.disbursed':       'bg-blue-100 text-blue-700',
  'team.member.created':  'bg-purple-100 text-purple-700',
  'team.member.deleted':  'bg-red-100 text-red-700',
  'settings.updated':     'bg-yellow-100 text-yellow-700',
  'product.created':      'bg-teal-100 text-teal-700',
  'product.updated':      'bg-teal-100 text-teal-700',
  'product.deleted':      'bg-red-100 text-red-700',
}

const actionLabels = {
  'loan.approved':        'Loan Approved',
  'loan.declined':        'Loan Declined',
  'loan.disbursed':       'Loan Disbursed',
  'team.member.created':  'Team Member Added',
  'team.member.deleted':  'Team Member Deleted',
  'settings.updated':     'Settings Updated',
  'product.created':      'Product Created',
  'product.updated':      'Product Updated',
  'product.deleted':      'Product Deleted',
}

export default function AdminAuditLogPage() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const limit = 50

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true)
      try {
        const res = await api.get(`/admin/audit-logs?page=${page}&limit=${limit}`)
        const data = res.data?.data || res.data
        setLogs(data.logs || [])
        setTotal(data.total || 0)
      } catch {
        setError('Failed to load audit logs.')
      } finally {
        setLoading(false)
      }
    }
    fetchLogs()
  }, [page])

  if (loading) return <AdminLayout><LoadingSpinner /></AdminLayout>

  return (
    <AdminLayout>
      <PageHeader
        title="Audit Logs"
        subtitle={`${total} total events`}
      />

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        {logs.length === 0 ? (
          <EmptyState
            icon={HiClipboardList}
            title="No audit logs yet"
            description="Actions taken by admins will appear here."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {['Date & Time', 'Action', 'Performed By', 'Reference'].map((h) => (
                      <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {formatDateTime(log.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${actionColors[log.action] || 'bg-gray-100 text-gray-600'}`}>
                          {actionLabels[log.action] || log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">
                          {log.first_name} {log.last_name}
                        </div>
                        <div className="text-xs text-gray-400">{log.email}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {log.entity_type ? `${log.entity_type.replace(/_/g, ' ')} #${log.entity_id}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {total > limit && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <p className="text-sm text-gray-500">
                  Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page * limit >= total}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  )
}
