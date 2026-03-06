import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { RefreshCw, TrendingUp, TrendingDown, Activity, Clock, AlertTriangle, BarChart3, IndianRupee, ArrowUpDown, Plus, Trash2, X, CheckCircle2, Edit3, Copy } from 'lucide-react';

const API_URL = '/api/options';

const OptionsTrackerPage = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastFetch, setLastFetch] = useState(null);
    const [symbol, setSymbol] = useState('NIFTY');
    const [transactions, setTransactions] = useState([]);

    // Algorithmic Trading State
    const [algoData, setAlgoData] = useState(null);
    const [algoLoading, setAlgoLoading] = useState(false);
    const [algoError, setAlgoError] = useState(null);

    const fetchData = useCallback(async (refresh = false) => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            params.set('symbol', symbol);
            if (refresh) params.set('refresh', 'true');
            const res = await axios.get(`${API_URL}/chain?${params.toString()}`);
            setData(res.data);
            setLastFetch(new Date());
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Failed to fetch data');
        } finally {
            setLoading(false);
        }
    }, [symbol]);

    const fetchTransactions = useCallback(async () => {
        try {
            const res = await axios.get(`${API_URL}/transactions?symbol=${symbol}`);
            setTransactions(res.data);
        } catch (err) {
            console.error('Failed to fetch transactions:', err);
        }
    }, [symbol]);

    useEffect(() => {
        fetchData();
        fetchTransactions();
    }, [fetchData, fetchTransactions]);

    const runAlgo = async () => {
        setAlgoLoading(true);
        setAlgoError(null);
        try {
            const res = await axios.get(`${API_URL}/algo/nifty?mode=live`);
            setAlgoData(res.data);
        } catch (err) {
            setAlgoError(err.response?.data?.error || err.message || 'Failed to run algo');
        } finally {
            setAlgoLoading(false);
        }
    };

    const handleSymbolToggle = (newSymbol) => {
        if (newSymbol !== symbol) {
            setData(null);
            setTransactions([]);
            setSymbol(newSymbol);
        }
    };

    const formatNumber = (n) => {
        if (n === undefined || n === null) return '-';
        return new Intl.NumberFormat('en-IN').format(n);
    };

    const formatCurrency = (n) => {
        if (n === undefined || n === null) return '-';
        return `₹${n.toFixed(2)}`;
    };

    const todayStr = () => new Date().toISOString().split('T')[0];

    // Get transactions for a specific option card
    const getCardTransactions = (expiry, strike, optionType) => {
        return transactions.filter(t =>
            t.expiry === expiry && t.strike === strike && t.option_type === optionType
        );
    };

    const OptionCard = ({ title, optionData, type, expiry }) => {
        const [showForm, setShowForm] = useState(false);
        const [editingId, setEditingId] = useState(null);
        const [form, setForm] = useState({ lots_sold: '', premium: '', margin: '', transaction_date: todayStr(), notes: '' });
        const [exitForm, setExitForm] = useState({ exit_price: '', notes: '' });
        const [submitting, setSubmitting] = useState(false);
        const [copied, setCopied] = useState(false);

        const formatExpiryForBroker = (dateStr) => {
            if (!dateStr) return '';
            const parts = dateStr.split('-');
            if (parts.length >= 2) {
                return `${parts[0]} ${parts[1]}`;
            }
            return dateStr;
        };

        const displayTitle = `${title} ${formatExpiryForBroker(expiry)}`;

        const handleCopy = () => {
            navigator.clipboard.writeText(displayTitle);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        };

        if (!optionData) {
            return (
                <div className="bg-white rounded-xl border border-slate-200 p-6 opacity-50">
                    <h4 className="font-semibold text-slate-400">{title}</h4>
                    <p className="text-sm text-slate-400 mt-2">No data available for this strike/expiry</p>
                </div>
            );
        }

        const isCE = type === 'CE';
        const Icon = isCE ? TrendingUp : TrendingDown;
        const cardTxns = getCardTransactions(expiry, optionData.strike, type);
        const hasExecuted = cardTxns.length > 0;

        const handleSubmit = async (e) => {
            e.preventDefault();
            setSubmitting(true);
            try {
                await axios.post(`${API_URL}/transactions`, {
                    symbol,
                    option_type: type,
                    strike: optionData.strike,
                    expiry,
                    lots_sold: parseInt(form.lots_sold),
                    premium: parseFloat(form.premium),
                    margin: parseFloat(form.margin),
                    transaction_date: form.transaction_date,
                    notes: form.notes
                });
                setForm({ lots_sold: '', premium: '', margin: '', transaction_date: todayStr(), notes: '' });
                setShowForm(false);
                fetchTransactions();
            } catch (err) {
                alert('Failed to save: ' + (err.response?.data?.error || err.message));
            } finally {
                setSubmitting(false);
            }
        };

        const handleDelete = async (id) => {
            if (!window.confirm('Delete this transaction?')) return;
            try {
                await axios.delete(`${API_URL}/transactions/${id}`);
                fetchTransactions();
            } catch (err) {
                alert('Failed to delete: ' + err.message);
            }
        };

        const handleExitUpdate = async (id) => {
            try {
                await axios.put(`${API_URL}/transactions/${id}`, {
                    exit_price: parseFloat(exitForm.exit_price),
                    notes: exitForm.notes
                });
                setEditingId(null);
                setExitForm({ exit_price: '', notes: '' });
                fetchTransactions();
            } catch (err) {
                alert('Failed to update: ' + err.message);
            }
        };

        return (
            <div className={`bg-white rounded-xl border ${hasExecuted ? 'border-amber-300 ring-1 ring-amber-200' : 'border-slate-200'} shadow-sm hover:shadow-md transition-shadow overflow-hidden`}>
                {/* Header */}
                <div className={`px-5 py-3 bg-gradient-to-r ${isCE ? 'from-emerald-500 to-teal-600' : 'from-rose-500 to-pink-600'} text-white`}>
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <Icon size={18} />
                            <span className="font-bold text-lg">{displayTitle}</span>
                            <button
                                onClick={handleCopy}
                                className="p-1 hover:bg-white/20 rounded-md transition-colors flex items-center justify-center shrink-0"
                                title="Copy for broker terminal"
                            >
                                {copied ? <CheckCircle2 size={16} className="text-emerald-200" /> : <Copy size={16} className="text-white/70 hover:text-white" />}
                            </button>
                            {hasExecuted && (
                                <span className="bg-amber-400 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                                    Executed ({cardTxns.length})
                                </span>
                            )}
                        </div>
                        <span className="text-2xl font-black">{formatCurrency(optionData.ltp)}</span>
                    </div>
                    <div className="flex justify-between items-center mt-1 text-white/80 text-xs">
                        <span>Strike: {formatNumber(optionData.strike)}</span>
                        <span className={`font-semibold ${optionData.change >= 0 ? 'text-white' : 'text-yellow-200'}`}>
                            {optionData.change >= 0 ? '+' : ''}{optionData.change?.toFixed(2)} ({optionData.pChange?.toFixed(2)}%)
                        </span>
                    </div>
                </div>

                {/* Metrics Grid */}
                <div className="p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <MetricBox label="Open Interest" value={formatNumber(optionData.oi)} icon={<BarChart3 size={14} />} />
                        <MetricBox label="OI Change" value={formatNumber(optionData.oiChange)} icon={<ArrowUpDown size={14} />}
                            valueColor={optionData.oiChange > 0 ? 'text-emerald-600' : optionData.oiChange < 0 ? 'text-rose-600' : ''} />
                        <MetricBox label="Volume" value={formatNumber(optionData.volume)} icon={<Activity size={14} />} />
                        <MetricBox label="IV" value={optionData.iv ? `${optionData.iv.toFixed(2)}%` : '-'} icon={<TrendingUp size={14} />} />
                    </div>

                    <div className="border-t border-slate-100 pt-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-emerald-50 rounded-lg p-2 text-center">
                                <div className="text-[10px] text-emerald-500 font-medium uppercase">Bid</div>
                                <div className="font-bold text-emerald-700">{formatCurrency(optionData.bid)}</div>
                                <div className="text-[10px] text-emerald-400">Qty: {formatNumber(optionData.bidQty)}</div>
                            </div>
                            <div className="bg-rose-50 rounded-lg p-2 text-center">
                                <div className="text-[10px] text-rose-500 font-medium uppercase">Ask</div>
                                <div className="font-bold text-rose-700">{formatCurrency(optionData.ask)}</div>
                                <div className="text-[10px] text-rose-400">Qty: {formatNumber(optionData.askQty)}</div>
                            </div>
                        </div>
                    </div>

                    {/* Existing Transactions */}
                    {cardTxns.length > 0 && (
                        <div className="border-t border-slate-100 pt-3">
                            <div className="text-[11px] font-semibold text-slate-500 uppercase mb-2">Sell Transactions</div>
                            <div className="space-y-2">
                                {cardTxns.map(txn => (
                                    <div key={txn.id} className={`rounded-lg p-2.5 text-xs ${txn.status === 'CLOSED' ? 'bg-slate-50 border border-slate-200' : 'bg-amber-50 border border-amber-200'}`}>
                                        <div className="flex justify-between items-start">
                                            <div className="space-y-0.5">
                                                <div className="font-semibold text-slate-700">
                                                    {txn.lots_sold} lot{txn.lots_sold > 1 ? 's' : ''} @ ₹{txn.premium}
                                                    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${txn.status === 'CLOSED' ? 'bg-slate-200 text-slate-600' : 'bg-amber-200 text-amber-700'}`}>
                                                        {txn.status}
                                                    </span>
                                                </div>
                                                <div className="text-slate-500">Margin: ₹{formatNumber(txn.margin)} · {txn.transaction_date}</div>
                                                {txn.exit_price != null && (
                                                    <div className="text-slate-500">
                                                        Exit: ₹{txn.exit_price}
                                                        {' · '}
                                                        <span className={txn.premium - txn.exit_price >= 0 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>
                                                            P&L: ₹{((txn.premium - txn.exit_price) * txn.lots_sold).toFixed(2)}
                                                        </span>
                                                    </div>
                                                )}
                                                {txn.notes && <div className="text-slate-400 italic">{txn.notes}</div>}
                                            </div>
                                            <div className="flex items-center gap-1">
                                                {txn.status === 'OPEN' && (
                                                    <button
                                                        onClick={() => { setEditingId(editingId === txn.id ? null : txn.id); setExitForm({ exit_price: '', notes: txn.notes || '' }); }}
                                                        className="text-blue-400 hover:text-blue-600 p-1" title="Add exit price"
                                                    >
                                                        <Edit3 size={13} />
                                                    </button>
                                                )}
                                                <button onClick={() => handleDelete(txn.id)} className="text-slate-300 hover:text-rose-500 p-1" title="Delete">
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </div>
                                        {/* Inline exit price form */}
                                        {editingId === txn.id && (
                                            <div className="mt-2 pt-2 border-t border-amber-200 flex items-center gap-2">
                                                <input type="number" step="0.01" placeholder="Exit price" value={exitForm.exit_price}
                                                    onChange={e => setExitForm({ ...exitForm, exit_price: e.target.value })}
                                                    className="w-24 px-2 py-1 rounded border border-slate-300 text-xs" />
                                                <input type="text" placeholder="Notes" value={exitForm.notes}
                                                    onChange={e => setExitForm({ ...exitForm, notes: e.target.value })}
                                                    className="flex-1 px-2 py-1 rounded border border-slate-300 text-xs" />
                                                <button onClick={() => handleExitUpdate(txn.id)}
                                                    className="bg-blue-500 text-white px-2 py-1 rounded text-[10px] font-semibold hover:bg-blue-600">Close</button>
                                                <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600">
                                                    <X size={13} />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Add Transaction Button / Form */}
                    <div className="border-t border-slate-100 pt-3">
                        {!showForm ? (
                            <button
                                onClick={() => setShowForm(true)}
                                className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-colors
                                    ${isCE ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-rose-50 text-rose-600 hover:bg-rose-100'}`}
                            >
                                <Plus size={16} />
                                Add Sell Transaction
                            </button>
                        ) : (
                            <form onSubmit={handleSubmit} className="space-y-2.5">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-[11px] font-semibold text-slate-500 uppercase">New Sell Transaction</span>
                                    <button type="button" onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                                        <X size={16} />
                                    </button>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <div>
                                        <label className="text-[10px] text-slate-500 font-medium block mb-0.5">Lots Sold</label>
                                        <input type="number" min="1" required value={form.lots_sold}
                                            onChange={e => setForm({ ...form, lots_sold: e.target.value })}
                                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-brand-400 focus:border-brand-400 outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-slate-500 font-medium block mb-0.5">Premium (₹)</label>
                                        <input type="number" step="0.01" min="0" required value={form.premium}
                                            onChange={e => setForm({ ...form, premium: e.target.value })}
                                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-brand-400 focus:border-brand-400 outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-slate-500 font-medium block mb-0.5">Margin (₹)</label>
                                        <input type="number" step="0.01" min="0" required value={form.margin}
                                            onChange={e => setForm({ ...form, margin: e.target.value })}
                                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-brand-400 focus:border-brand-400 outline-none" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-[10px] text-slate-500 font-medium block mb-0.5">Date</label>
                                        <input type="date" required value={form.transaction_date}
                                            onChange={e => setForm({ ...form, transaction_date: e.target.value })}
                                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-brand-400 focus:border-brand-400 outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-slate-500 font-medium block mb-0.5">Notes (optional)</label>
                                        <input type="text" value={form.notes}
                                            onChange={e => setForm({ ...form, notes: e.target.value })}
                                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-brand-400 focus:border-brand-400 outline-none"
                                            placeholder="e.g. weekly sell" />
                                    </div>
                                </div>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className={`w-full py-2 rounded-lg text-white font-semibold text-sm transition-colors
                                        ${isCE ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}
                                        ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    {submitting ? 'Saving...' : 'Record Sell'}
                                </button>
                            </form>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const MetricBox = ({ label, value, icon, valueColor = '' }) => (
        <div className="bg-slate-50 rounded-lg p-2.5">
            <div className="flex items-center gap-1 text-[10px] text-slate-400 font-medium uppercase mb-1">
                {icon} {label}
            </div>
            <div className={`font-bold text-slate-700 text-sm ${valueColor}`}>{value}</div>
        </div>
    );

    const getExpiryMetadata = (dateStr) => {
        if (!dateStr) return { label: 'Unknown', isMonthly: false };
        const months = { 'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5, 'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11 };

        let parts = dateStr.split('-');
        if (parts.length !== 3) parts = dateStr.split(' ');
        if (parts.length !== 3) return { label: dateStr, isMonthly: false };

        const expDate = new Date(parts[2], months[parts[1]], parseInt(parts[0], 10));
        const weekday = expDate.toLocaleDateString('en-US', { weekday: 'long' });

        // Check if it's monthly (adding 7 days pushes it to next month)
        const nextWeek = new Date(expDate);
        nextWeek.setDate(expDate.getDate() + 7);
        const isMonthly = nextWeek.getMonth() !== expDate.getMonth();

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const currentDay = today.getDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
        // Treat Monday as start of week (1), Sunday as end (0)
        const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() + mondayOffset);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);

        const startOfNextWeek = new Date(endOfWeek);
        startOfNextWeek.setDate(endOfWeek.getDate() + 1);
        const endOfNextWeek = new Date(startOfNextWeek);
        endOfNextWeek.setDate(startOfNextWeek.getDate() + 6);

        let prefix = '';
        if (expDate >= startOfWeek && expDate <= endOfWeek) {
            prefix = 'This ';
        } else if (expDate >= startOfNextWeek && expDate <= endOfNextWeek) {
            prefix = 'Next ';
        }

        let label = '';
        if (prefix) {
            label = `${prefix}${weekday}`;
        } else {
            const dd = String(expDate.getDate()).padStart(2, '0');
            const mm = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][expDate.getMonth()];
            const yy = expDate.getFullYear();
            label = `${dd}-${mm}-${yy} (${weekday})`;
        }

        return { label, isMonthly };
    };

    const spotLabel = data?.label || symbol;

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <IndianRupee className="text-brand-600" /> Rams's Option Builder
                    </h1>
                    <p className="text-slate-500 text-sm">
                        Track OTM option premiums for your selling strategy
                    </p>
                </div>

                {/* Algo Trigger Button */}
                <button
                    onClick={runAlgo}
                    disabled={algoLoading}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium shadow-sm transition-colors border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 ${algoLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    <Activity size={16} className={algoLoading ? 'animate-pulse' : ''} />
                    {algoLoading ? 'Analyzing Markets...' : '9:30 AM Live Risk Score'}
                </button>

                <div className="flex items-center gap-3">
                    {/* Symbol Toggle */}
                    <div className="flex bg-slate-100 rounded-lg p-0.5">
                        {['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'].map((s) => (
                            <button
                                key={s}
                                onClick={() => handleSymbolToggle(s)}
                                className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-all ${symbol === s
                                    ? 'bg-brand-600 text-white shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                                    }`}
                            >
                                {s === 'FINNIFTY' ? 'FINNIFTY' : s}
                            </button>
                        ))}
                    </div>

                    {lastFetch && (
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                            <Clock size={12} />
                            {lastFetch.toLocaleTimeString()}
                            {data?.cached && <span className="text-amber-500">(cached)</span>}
                        </span>
                    )}
                    <button
                        onClick={() => fetchData(true)}
                        disabled={loading}
                        className={`flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-colors ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        {loading ? 'Fetching...' : 'Refresh'}
                    </button>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-center gap-3">
                    <AlertTriangle className="text-rose-500" size={20} />
                    <span className="text-rose-700 text-sm">{error}</span>
                </div>
            )}

            {/* Loading State */}
            {loading && !data && (
                <div className="text-center py-20">
                    <RefreshCw size={40} className="mx-auto text-brand-400 animate-spin mb-4" />
                    <p className="text-slate-500">Fetching live {symbol} data...</p>
                    <p className="text-slate-400 text-sm mt-1">This may take 10-15 seconds on first load</p>
                </div>
            )}

            {/* Algo Results Display */}
            {(algoData || algoError) && (
                <div className={`mt-4 rounded-xl border p-5 ${algoError ? 'bg-rose-50 border-rose-200' : 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200'}`}>
                    <div className="flex justify-between items-start mb-2">
                        <h3 className="font-bold text-lg flex items-center gap-2 text-blue-900">
                            <BarChart3 className="text-blue-600" /> Live Python Strategy Engine
                        </h3>
                        <button onClick={() => { setAlgoData(null); setAlgoError(null); }} className="text-blue-400 hover:text-blue-600">
                            <X size={20} />
                        </button>
                    </div>
                    {algoError ? (
                        <div className="text-rose-600 flex items-start gap-2 text-sm max-h-32 overflow-y-auto">
                            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                            <pre className="whitespace-pre-wrap font-sans">{algoError}</pre>
                        </div>
                    ) : (
                        <div className="bg-white rounded-lg p-4 border border-blue-100 shadow-sm mt-3">
                            <div className="font-mono text-sm sm:text-base text-slate-800 break-words whitespace-pre-wrap border-l-4 border-blue-500 pl-3 py-1">
                                {algoData?.result || JSON.stringify(algoData, null, 2)}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Data Display */}
            {data && (
                <>
                    {/* Spot Price Banner */}
                    <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-2xl p-6 text-white shadow-xl">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">{spotLabel} Spot</p>
                                <p className="text-4xl font-black mt-1">{formatNumber(data.spot)}</p>
                                {data.anchorPrice && (
                                    <div className="mt-2 flex items-center gap-1.5 text-slate-400 bg-slate-800/50 py-1 px-2 rounded w-fit">
                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
                                        <p className="text-xs font-medium">Open: {formatNumber(data.anchorPrice)}</p>
                                    </div>
                                )}
                            </div>
                            <div className="text-right space-y-2">
                                <div className="bg-emerald-500/20 border border-emerald-500/30 rounded-lg px-3 py-1.5">
                                    <p className="text-[10px] text-emerald-300 uppercase font-medium">CE Strike ({data.anchorPrice ? 'Open' : 'Spot'} + {data.strikeOffset || (symbol === 'NIFTY' ? 1000 : 3500)})</p>
                                    <p className="font-bold text-emerald-400 text-lg">{formatNumber(data.ceStrike)}</p>
                                </div>
                                <div className="bg-rose-500/20 border border-rose-500/30 rounded-lg px-3 py-1.5">
                                    <p className="text-[10px] text-rose-300 uppercase font-medium">PE Strike ({data.anchorPrice ? 'Open' : 'Spot'} − {data.strikeOffset || (symbol === 'NIFTY' ? 1000 : 3500)})</p>
                                    <p className="font-bold text-rose-400 text-lg">{formatNumber(data.peStrike)}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Expiry Sections */}
                    {data.expiries?.map((exp, idx) => {
                        const meta = getExpiryMetadata(exp.expiry);
                        return (
                            <div key={exp.expiry} className="space-y-4">
                                <div className="flex items-center gap-3 flex-wrap">
                                    <h2 className="text-lg font-bold text-slate-700">
                                        📅 {meta.label}
                                    </h2>
                                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider ${meta.isMonthly ? 'bg-purple-100 text-purple-700 border border-purple-200' : 'bg-blue-50 text-blue-600 border border-blue-200'}`}>
                                        {meta.isMonthly ? 'Monthly' : 'Weekly'}
                                    </span>
                                    <span className="bg-slate-100 text-slate-600 px-3 py-1 rounded-full text-xs font-semibold">
                                        Expiry: {exp.expiry}
                                    </span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <OptionCard
                                        title={`${symbol === 'MIDCPNIFTY' ? 'MIDCAPNIFTY' : symbol} ${data.ceStrike} CE`}
                                        optionData={exp.ce}
                                        type="CE"
                                        expiry={exp.expiry}
                                    />
                                    <OptionCard
                                        title={`${symbol === 'MIDCPNIFTY' ? 'MIDCAPNIFTY' : symbol} ${data.peStrike} PE`}
                                        optionData={exp.pe}
                                        type="PE"
                                        expiry={exp.expiry}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </>
            )}
        </div>
    );
};

export default OptionsTrackerPage;
