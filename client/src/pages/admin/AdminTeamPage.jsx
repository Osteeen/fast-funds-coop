import React, { useEffect, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import PageHeader from '../../components/common/PageHeader'
import EmptyState from '../../components/common/EmptyState'
import LoadingSpinner from '../../components/common/LoadingSpinner'
import api, { formatDate } from '../../utils/api'
import { useAuth } from '../../context/AuthContext'
import { HiUserGroup, HiPlus, HiX, HiEye, HiEyeOff } from 'react-icons/hi'
import toast from 'react-hot-toast'

const roleColors = {
  super_admin: 'bg-purple-100 text-purple-700',
  approver: 'bg-blue-100 text-blue-700',
  viewer: 'bg-gray-100 text-gray-600',
}
const roleLabels = {
  super_admin: 'Super Admin',
  approver: 'Approver',
  viewer: 'Viewer',
}

const defaultForm = {
  first_name: '', last_name: '', email: '', role: 'viewer', password: '', confirm_password: '',
}

export default function AdminTeamPage() {
  const { user, isRole } = useAuth()
  const [team, setTeam] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(defaultForm)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const isSuperAdmin = isRole('super_admin')

  useEffect(() => {
    const fetchTeam = async () => {
      try {
        const res = await api.get('/admin/team')
        const data = res.data?.data || res.data
        setTeam(Array.isArray(data.members) ? data.members : (Array.isArray(data) ? data : []))
      } catch {
        setError('Failed to load team members.')
      } finally {
        setLoading(false)
      }
    }
    fetchTeam()
  }, [])

  const handleChange = (e) => {
    setFormError('')
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.first_name || !form.last_name || !form.email || !form.password) {
      setFormError('All fields are required.')
      return
    }
    if (form.password.length < 8) {
      setFormError('Password must be at least 8 characters.')
      return
    }
    if (form.password !== form.confirm_password) {
      setFormError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    setFormError('')
    try {
      const { confirm_password, ...payload } = form
      const res = await api.post('/admin/team', payload)
      const newMember = res.data?.data?.member || res.data?.member || res.data?.user || res.data
      setTeam((prev) => [newMember, ...prev])
      setShowModal(false)
      setForm(defaultForm)
      toast.success('Team member added successfully!')
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to add team member.'
      setFormError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <AdminLayout><LoadingSpinner /></AdminLayout>

  return (
    <AdminLayout>
      <PageHeader
        title="Team Members"
        subtitle={`${team.length} admin users`}
        action={
          isSuperAdmin ? (
            <button
              onClick={() => setShowModal(true)}
              className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
            >
              <HiPlus className="w-4 h-4" />
              Add Team Member
            </button>
          ) : null
        }
      />

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        {team.length === 0 ? (
          <EmptyState
            icon={HiUserGroup}
            title="No team members"
            description="Add your first team member to get started."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Member', 'Email', 'Role', 'Joined', 'Status'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {team.map((member) => (
                  <tr key={member.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-900 flex items-center justify-center text-xs font-bold">
                          {(member.first_name || 'A').charAt(0)}{(member.last_name || '').charAt(0)}
                        </div>
                        <span className="font-medium text-gray-900">
                          {member.first_name} {member.last_name}
                          {member.id === user?.id && (
                            <span className="ml-2 text-xs bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded-full">
                              You
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{member.email}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColors[member.role] || roleColors.viewer}`}>
                        {roleLabels[member.role] || member.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(member.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        member.is_active !== false
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {member.is_active !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Team Member Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900">Add Team Member</h2>
              <button
                onClick={() => { setShowModal(false); setForm(defaultForm); setFormError('') }}
                className="p-1.5 rounded-lg hover:bg-gray-100"
              >
                <HiX className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label text-xs">First Name *</label>
                  <input
                    type="text"
                    name="first_name"
                    value={form.first_name}
                    onChange={handleChange}
                    className="input-field text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="form-label text-xs">Last Name *</label>
                  <input
                    type="text"
                    name="last_name"
                    value={form.last_name}
                    onChange={handleChange}
                    className="input-field text-sm"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="form-label text-xs">Email Address *</label>
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  className="input-field text-sm"
                  required
                />
              </div>

              <div>
                <label className="form-label text-xs">Role *</label>
                <select
                  name="role"
                  value={form.role}
                  onChange={handleChange}
                  className="input-field text-sm"
                >
                  <option value="approver">Approver</option>
                  <option value="viewer">Viewer</option>
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  Approver: Can review and approve loans. Viewer: Read-only access.
                </p>
              </div>

              <div>
                <label className="form-label text-xs">Password *</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={form.password}
                    onChange={handleChange}
                    className="input-field text-sm pr-9"
                    placeholder="Min. 8 characters"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                    tabIndex={-1}
                  >
                    {showPassword ? <HiEyeOff className="w-4 h-4" /> : <HiEye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="form-label text-xs">Confirm Password *</label>
                <input
                  type="password"
                  name="confirm_password"
                  value={form.confirm_password}
                  onChange={handleChange}
                  className="input-field text-sm"
                  required
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setForm(defaultForm); setFormError('') }}
                  className="flex-1 btn-secondary py-2.5 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 btn-primary py-2.5 text-sm flex items-center justify-center gap-2"
                >
                  {submitting && (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  Add Member
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
