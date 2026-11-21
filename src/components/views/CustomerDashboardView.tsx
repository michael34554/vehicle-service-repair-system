import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../api';

interface Vehicle {
  id: string;
  plate: string;
  vin: string;
  make: string;
  model: string;
  model_year: number;
  color: string;
  mileage: number;
  created_at: string;
  updated_at: string;
}

interface Job {
  id: string;
  job_no: string;
  service_type: string;
  issue_description: string;
  status: string;
  repair_status: string;
  repair_priority: string;
  promised_at: string;
  created_at: string;
  updated_at: string;
  assigned_mechanic_name?: string | null;
  assigned_mechanic_specialization?: string | null;
}

interface StatusHistory {
  previous_status: string;
  new_status: string;
  note: string;
  changed_by_name: string;
  changed_at: string;
}

export const CustomerDashboardView: React.FC = () => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [statusHistory, setStatusHistory] = useState<StatusHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    apiFetch('/api/customer/vehicles')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Vehicles request failed (${res.status}).`);
        return res.json();
      })
      .then((data) => setVehicles(data.vehicles || []))
      .catch(() => setError('Unable to load vehicles.'))
      .finally(() => setLoading(false));
  }, []);

  const handleSelectVehicle = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    setSelectedJob(null);
    setStatusHistory([]);
    setLoading(true);
    apiFetch(`/api/customer/vehicles/${vehicle.id}/jobs`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Jobs request failed (${res.status}).`);
        return res.json();
      })
      .then((data) => setJobs(data.jobs || []))
      .catch(() => setError('Unable to load jobs.'))
      .finally(() => setLoading(false));
  };

  const handleSelectJob = (job: Job) => {
    setSelectedJob(job);
    setLoading(true);
    apiFetch(`/api/customer/jobs/${job.id}/status-history`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Status history request failed (${res.status}).`);
        return res.json();
      })
      .then((data) => setStatusHistory(data.history || []))
      .catch(() => setError('Unable to load status history.'))
      .finally(() => setLoading(false));
  };

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-[#111827] p-4">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">My Vehicles & Service Tracking</h1>
        {error && <div className="mb-4 text-red-600">{error}</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <section>
            <h2 className="text-xl font-semibold mb-2">Registered Vehicles</h2>
            {loading && <div>Loading…</div>}
            <ul className="divide-y divide-gray-200">
              {vehicles.map((v) => (
                <li key={v.id} className={`py-3 cursor-pointer ${selectedVehicle?.id === v.id ? 'bg-blue-50' : ''}`} onClick={() => handleSelectVehicle(v)}>
                  <div className="font-medium">{v.plate} – {v.make} {v.model} ({v.model_year})</div>
                  <div className="text-xs text-gray-500">VIN: {v.vin} | Color: {v.color}</div>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="text-xl font-semibold mb-2">Service & Repair Jobs</h2>
            {selectedVehicle ? (
              <ul className="divide-y divide-gray-200">
                {jobs.map((job) => (
                  <li key={job.id} className={`py-3 cursor-pointer ${selectedJob?.id === job.id ? 'bg-blue-50' : ''}`} onClick={() => handleSelectJob(job)}>
                    <div className="font-medium">{job.service_type} – {job.repair_status}</div>
                    <div className="text-xs text-gray-500">Job #: {job.job_no} | Promised: {job.promised_at ? new Date(job.promised_at).toLocaleString() : 'N/A'}</div>
                    <div className="mt-1 text-xs text-blue-700">Mechanic: {job.assigned_mechanic_name ?? 'Not yet assigned'}{job.assigned_mechanic_specialization ? ` · ${job.assigned_mechanic_specialization}` : ''}</div>
                  </li>
                ))}
              </ul>
            ) : <div className="text-gray-500">Select a vehicle to view jobs.</div>}
          </section>
        </div>
        <section className="mt-8">
          <h2 className="text-xl font-semibold mb-2">Repair Progress</h2>
          {selectedJob ? (
            <ol className="border-l-2 border-blue-400 pl-4">
              {statusHistory.map((h, idx) => (
                <li key={idx} className="mb-4">
                  <div className="font-semibold text-blue-700">{h.new_status}</div>
                  <div className="text-xs text-gray-500">{new Date(h.changed_at).toLocaleString()} by {h.changed_by_name}</div>
                  {h.note && <div className="text-sm text-gray-700 mt-1">{h.note}</div>}
                </li>
              ))}
            </ol>
          ) : <div className="text-gray-500">Select a job to view progress.</div>}
        </section>
      </div>
    </main>
  );
};
