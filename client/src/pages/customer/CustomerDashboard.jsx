import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/common/Navbar'
import Footer from '../../components/common/Footer'
import LoadingSpinner from '../../components/common/LoadingSpinner'
import StatusBadge from '../../components/common/StatusBadge'
import EmptyState from '../../components/common/EmptyState'
import api, { formatNaira, formatDate, formatDateTime } from '../../utils/api'
import { useAuth } from '../../context/AuthContext'
import {
  HiCreditCard,
  HiClipboardList,
  HiBell,
  HiCheckCircle,
  HiClock,
  HiArrowRight,
  HiInbox,
} from 'react-icons/hi'
import toast from 'react-hot-toast'

const tierLabels = { 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3' }
const tierColors = {
  1: 'bg-gray-100 text-gray-700',
  2: 'bg-blue-100 text-blue-700',
  3: 'bg-purple-100 text-purple-700',
}

export default function CustomerDashboard() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const res = await api.get('/customer/dashboard')
        setData(res.data?.data || res.data)
      } catch (err) {
        setError('Failed to load dashboard data.')
      } finally {
        setLoading(false)
      }
    }
    fetchDashboard()
  }, [])

  const markAllRead = async () => {
    try {
      await api.patch('/customer/notifications/read-all')
      setData((prev) => ({
        ...prev,
        notifications: prev.notifications?.map((n) => ({ ...n, read: true })),
      }))
      toast.success('All notifications marked as read')
    } catch {
      toast.error('Failed to update notifications')
    }
  }

  if (loading) return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="flex-1"><LoadingSpinner text="Loading dashboard..." /></div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="flex-1 flex items-center justify-center">
        <p className="text-red-600">{error}</p>
      </div>
    </div>
  )

  const account = data?.account || {}
  const eligibility = data?.eligibility || {}
  const activeLoan = data?.active_loan || null
  const nextRepayment = data?.next_repayment || null
  const notifications = data?.notifications || []

  // Calculate repayment progress
  const progress = activeLoan
    ? Math.round(
        ((activeLoan.total_repaid || 0) / (activeLoan.total_repayable || 1)) * 100
      )
    : 0

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Navbar />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">

        {/* Welcome Banner */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back, {account.first_name || user?.first_name || 'Customer'}!
          </h1>
          <p className="text-gray-500 text-sm mt-1">Here's a summary of your account.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-6">

            {/* Account Info Card */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">Account Information</h2>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${tierColors[account.tier] || tierColors[1]}`}>
                  {tierLabels[account.tier] || 'Tier 1'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Full Name</p>
                  <p className="font-semibold text-gray-900">
                    {account.first_name} {account.last_name}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Account Number</p>
                  <p className="font-mono font-semibold text-gray-900 tracking-wider">
                    {account.account_number || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Bank Name</p>
                  <p className="font-semibold text-gray-900">
                    {account.bank_name || 'Kufre Microfinance Bank'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Email</p>
                  <p className="font-semibold text-gray-900">{account.email || user?.email}</p>
                </div>
              </div>
            </div>

            {/* Eligibility Card */}
            <div className="card border-l-4 border-l-green-500">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-semibold text-gray-900 mb-1">Loan Eligibility</h2>
                  {eligibility.eligible ? (
                    <>
                      <p className="text-sm text-gray-500">
                        Based on your{' '}
                        <strong>{tierLabels[account.tier] || 'Tier 1'}</strong> status, you can borrow up to:
                      </p>
                      <p className="text-3xl font-bold text-primary-900 mt-2">
                        {formatNaira(eligibility.max_amount)}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-500">
                      {eligibility.reason || 'You currently have an active loan. Repay it to apply for another.'}
                    </p>
                  )}
                </div>
                <HiCreditCard className="w-8 h-8 text-green-500 shrink-0" />
              </div>
              {eligibility.eligible && (
                <Link
                  to="/apply"
                  className="mt-4 inline-flex items-center gap-2 btn-primary px-5 py-2.5 text-sm"
                >
                  Apply Now <HiArrowRight className="w-4 h-4" />
                </Link>
              )}
            </div>

            {/* Active Loan Card */}
            {activeLoan ? (
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold text-gray-900">
                    {['disbursed', 'approved'].includes(activeLoan.status) ? 'Active Loan' : 'Loan Application'}
                  </h2>
                  <StatusBadge status={activeLoan.status} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                  {[
                    { label: 'Amount', value: formatNaira(activeLoan.amount_approved || activeLoan.amount_requested) },
                    { label: 'Tenor', value: `${activeLoan.tenor_months || activeLoan.tenor} months` },
                    { label: 'Monthly Payment', value: formatNaira(activeLoan.monthly_repayment) },
                    { label: 'Product', value: activeLoan.product_name || 'Quick Loan' },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-xs text-gray-500">{label}</p>
                      <p className="font-semibold text-gray-900 text-sm">{value}</p>
                    </div>
                  ))}
                </div>
                {/* Progress Bar */}
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Repayment Progress</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>Paid: {formatNaira(activeLoan.total_repaid || 0)}</span>
                    <span>Remaining: {formatNaira((activeLoan.total_repayable || 0) - (activeLoan.total_repaid || 0))}</span>
                  </div>
                </div>
                <Link
                  to={`/loans/${activeLoan.id}`}
                  className="mt-4 inline-flex items-center gap-2 text-sm text-primary-900 font-medium hover:underline"
                >
                  View Full Details <HiArrowRight className="w-4 h-4" />
                </Link>
              </div>
            ) : (
              <div className="card">
                <EmptyState
                  icon={HiClipboardList}
                  title="No Active Loan"
                  description="You don't have an active loan right now. Apply for one to get started."
                  action={
                    <Link to="/apply" className="btn-primary px-5 py-2 text-sm">
                      Apply for a Loan
                    </Link>
                  }
                />
              </div>
            )}
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Next Repayment */}
            {nextRepayment ? (
              <div className="card border-t-4 border-t-orange-400">
                <div className="flex items-center gap-3 mb-3">
                  <HiClock className="w-5 h-5 text-orange-500" />
                  <h2 className="font-semibold text-gray-900">Next Repayment</h2>
                </div>
                <p className="text-3xl font-bold text-gray-900">
                  {formatNaira(nextRepayment.total_amount || nextRepayment.amount)}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Due on <strong className="text-gray-700">{formatDate(nextRepayment.due_date)}</strong>
                </p>
                {new Date(nextRepayment.due_date) < new Date() && (
                  <div className="mt-2 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
                    This repayment is overdue!
                  </div>
                )}
              </div>
            ) : null}

            {/* Quick Actions */}
            <div className="card">
              <h2 className="font-semibold text-gray-900 mb-3">Quick Actions</h2>
              <div className="space-y-2">
                <Link
                  to="/apply"
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center">
                    <HiCreditCard className="w-4 h-4 text-primary-900" />
                  </div>
                  <span className="text-sm font-medium text-gray-700">Apply for a Loan</span>
                  <HiArrowRight className="w-4 h-4 text-gray-400 ml-auto" />
                </Link>
                <Link
                  to="/profile"
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                    <HiCheckCircle className="w-4 h-4 text-blue-600" />
                  </div>
                  <span className="text-sm font-medium text-gray-700">My Profile</span>
                  <HiArrowRight className="w-4 h-4 text-gray-400 ml-auto" />
                </Link>
              </div>
            </div>

            {/* Notifications */}
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <HiBell className="w-5 h-5 text-gray-600" />
                  <h2 className="font-semibold text-gray-900">Notifications</h2>
                  {notifications.filter((n) => !n.read).length > 0 && (
                    <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-medium">
                      {notifications.filter((n) => !n.read).length}
                    </span>
                  )}
                </div>
                {notifications.some((n) => !n.read) && (
                  <button
                    onClick={markAllRead}
                    className="text-xs text-primary-900 hover:underline"
                  >
                    Mark all read
                  </button>
                )}
              </div>

              {notifications.length === 0 ? (
                <EmptyState
                  icon={HiInbox}
                  title="No notifications"
                  description="You're all caught up!"
                />
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {notifications.slice(0, 5).map((notif) => (
                    <div
                      key={notif.id}
                      className={`p-3 rounded-lg text-sm ${notif.read ? 'bg-gray-50' : 'bg-primary-50 border border-primary-100'}`}
                    >
                      <p className={`${notif.read ? 'text-gray-600' : 'text-gray-900 font-medium'}`}>
                        {notif.message}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">{formatDateTime(notif.created_at)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
