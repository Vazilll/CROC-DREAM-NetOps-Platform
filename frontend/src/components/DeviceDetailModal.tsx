import React, { useEffect, useState } from 'react';
import { X, Network, Server, Shield, Globe, Cpu, AlertTriangle } from 'lucide-react';
import { api } from '../api';
import type { DeviceDetail } from '../api';

interface DeviceDetailModalProps {
  deviceId: number;
  onClose: () => void;
}

export const DeviceDetailModal: React.FC<DeviceDetailModalProps> = ({ deviceId, onClose }) => {
  const [device, setDevice] = useState<DeviceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    api
      .getDevice(deviceId)
      .then((data) => {
        if (mounted) {
          setDevice(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [deviceId]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
        <div className="bg-[#0c0e14] border border-white/[0.08] rounded-2xl p-6 max-w-lg w-full text-center font-mono">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400 mx-auto mb-4" />
          <p className="text-xs text-zinc-400">Загрузка параметров устройства...</p>
        </div>
      </div>
    );
  }

  if (error || !device) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
        <div className="bg-[#0c0e14] border border-rose-500/30 rounded-2xl p-6 max-w-lg w-full text-center font-mono">
          <AlertTriangle className="h-8 w-8 text-rose-500 mx-auto mb-2" />
          <h3 className="text-sm font-semibold text-rose-200">Ошибка загрузки</h3>
          <p className="text-xs text-rose-300/80 mt-1">{error || 'Устройство не найдено'}</p>
          <button
            onClick={onClose}
            className="mt-4 px-4 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-xs font-medium rounded-lg text-zinc-200 transition cursor-pointer"
          >
            Закрыть
          </button>
        </div>
      </div>
    );
  }

  const { intent } = device;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-[#0c0e14] border border-white/[0.08] rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold font-mono text-white flex items-center space-x-2">
                <span>{device.hostname}</span>
                <span className="text-xs px-2 py-0.5 rounded bg-zinc-900 border border-white/[0.08] text-zinc-300 font-mono">
                  {device.management_ip}:{device.management_port}
                </span>
              </h2>
              <p className="text-xs text-zinc-400 font-mono mt-0.5">
                Платформа: <span className="text-zinc-200 uppercase">{device.platform}</span> • Роль: <span className="text-zinc-200 capitalize">{device.role}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Intent Summary */}
          {intent ? (
            <>
              {/* Interfaces */}
              <div>
                <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400 mb-3 flex items-center space-x-1.5">
                  <Network className="w-4 h-4 text-cyan-400" />
                  <span>Интерфейсы ({intent.interfaces.length})</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {intent.interfaces.map((iface) => (
                    <div
                      key={iface.name}
                      className="p-3 bg-zinc-950 border border-white/[0.06] rounded-xl text-xs space-y-1.5 font-mono"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-zinc-200">{iface.name}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            iface.enabled
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-zinc-900 text-zinc-500'
                          }`}
                        >
                          {iface.enabled ? 'ENABLED' : 'DISABLED'}
                        </span>
                      </div>
                      <div className="text-zinc-400 text-[11px] truncate">
                        {iface.description || 'Нет описания'}
                      </div>
                      <div className="flex items-center justify-between text-[11px] pt-1 border-t border-white/[0.04]">
                        <span className="text-zinc-500">IP: {iface.ipv4_address || '—'}</span>
                        <span className="text-zinc-500">MTU: {iface.mtu}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* BGP */}
              {intent.bgp && (
                <div>
                  <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400 mb-3 flex items-center space-x-1.5">
                    <Globe className="w-4 h-4 text-indigo-400" />
                    <span>Динамическая маршрутизация BGP (ASN {intent.bgp.asn})</span>
                  </h3>
                  <div className="bg-zinc-950 border border-white/[0.06] rounded-xl p-3.5 space-y-3 font-mono">
                    <div className="flex items-center space-x-6 text-xs">
                      <div>
                        <span className="text-zinc-500 block text-[10px]">Router ID</span>
                        <span className="text-zinc-200">{intent.bgp.router_id}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block text-[10px]">Local ASN</span>
                        <span className="text-zinc-200">{intent.bgp.asn}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block text-[10px]">Соседей BGP</span>
                        <span className="text-zinc-200">{intent.bgp.neighbors.length}</span>
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-white/[0.06]">
                      <span className="text-[11px] font-semibold text-zinc-400">Пиринговые связи:</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {intent.bgp.neighbors.map((n) => (
                          <div
                            key={n.peer_ip}
                            className="bg-[#0c0e14] border border-white/[0.06] rounded-lg p-2.5 text-xs flex justify-between items-center"
                          >
                            <div>
                              <div className="text-cyan-300 font-medium">{n.peer_ip}</div>
                              <div className="text-[11px] text-zinc-500">{n.description || 'Neighbor'}</div>
                            </div>
                            <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[10px]">
                              AS {n.remote_asn}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ACLs */}
              {intent.acls && intent.acls.length > 0 && (
                <div>
                  <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400 mb-3 flex items-center space-x-1.5">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    <span>Списки доступа ACL ({intent.acls.length})</span>
                  </h3>
                  <div className="space-y-2.5">
                    {intent.acls.map((acl) => (
                      <div
                        key={acl.name}
                        className="bg-zinc-950 border border-white/[0.06] rounded-xl p-3 text-xs space-y-2 font-mono"
                      >
                        <div className="font-semibold text-emerald-300">{acl.name}</div>
                        <div className="space-y-1">
                          {acl.rules.map((rule) => (
                            <div
                              key={rule.sequence}
                              className="text-[11px] px-2 py-1 rounded bg-[#0c0e14] flex items-center justify-between text-zinc-300 border border-white/[0.04]"
                            >
                              <span>
                                #{rule.sequence} {rule.action.toUpperCase()} {rule.protocol} {rule.source} → {rule.destination}
                              </span>
                              <span
                                className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                                  rule.action === 'permit' ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {rule.action.toUpperCase()}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="p-8 text-center text-zinc-500 font-mono text-xs">
              <Cpu className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>Intent файл для {device.hostname} не найден в Git-репозитории.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/[0.06] flex justify-end font-mono">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs font-medium transition cursor-pointer"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
