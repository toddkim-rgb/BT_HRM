import { useState } from 'react';
import { Badge, Card, ErrorBox, Field, Loading, PageHeader, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ASG_ROLE, ASG_STATUS, EMP_STATUS, EMPLOY_TYPE, ROLE_LABEL } from '../lib/codes';
import { label } from '../lib/format';
import { useFetch } from '../lib/hooks';
import type { Employee } from './Employees';

export default function MyInfo() {
  const { user, logout } = useAuth();
  const { data, error } = useFetch<
    Employee & { assignments: { asgId: number; prjCd: string; roleCd: string; startDt: string; endDt: string; allocRate: number; status: string; project: { prjNm: string } }[] }
  >(`/employees/${user!.empId}`);

  return (
    <div>
      <PageHeader
        title="내 정보"
        actions={
          <button className="btn" onClick={logout}>
            로그아웃
          </button>
        }
      />
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : (
        <div className="grid cols-2">
          <Card title="인력 정보">
            <dl className="desc-list">
              <dt>사번</dt>
              <dd>{data.empId}</dd>
              <dt>성명</dt>
              <dd>
                <strong>{data.name}</strong>
              </dd>
              <dt>이메일 (로그인)</dt>
              <dd>{data.email}</dd>
              <dt>소속 / 직급</dt>
              <dd>
                {data.deptCd} / {data.gradeCd}
              </dd>
              <dt>고용형태</dt>
              <dd>
                {label(EMPLOY_TYPE, data.employType)} {data.partner && `· ${data.partner.partnerNm}`}
              </dd>
              <dt>기술</dt>
              <dd>
                {data.skillLevel} {data.skillStack && `· ${data.skillStack}`}
              </dd>
              <dt>경력</dt>
              <dd>{data.careerYears != null ? `${data.careerYears}년` : '-'}</dd>
              <dt>상태</dt>
              <dd>{label(EMP_STATUS, data.statusCd)}</dd>
              <dt>시스템 권한</dt>
              <dd>{label(ROLE_LABEL, data.role)}</dd>
            </dl>
          </Card>
          <PasswordCard />
          <Card title="투입 이력" className="full">
            {data.assignments.map((a) => (
              <div key={a.asgId} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span>
                  <strong>{a.prjCd}</strong> <span className="small muted">{a.project.prjNm}</span>
                  <div className="small muted">
                    {label(ASG_ROLE, a.roleCd)} · {a.allocRate}% · {a.startDt} ~ {a.endDt}
                  </div>
                </span>
                <Badge code={a.status}>{label(ASG_STATUS, a.status)}</Badge>
              </div>
            ))}
            {!data.assignments.length && <p className="muted">투입 이력이 없습니다.</p>}
          </Card>
        </div>
      )}
    </div>
  );
}

function PasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    if (next !== confirm) return setErr('새 비밀번호가 일치하지 않습니다.');
    try {
      await api.put('/auth/me/password', { current, next });
      toast('비밀번호를 변경했습니다.');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Card title="비밀번호 변경">
      <ErrorBox error={err} />
      <div className="stack" style={{ gap: 10 }}>
        <Field label="현재 비밀번호">
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="새 비밀번호" hint="4자 이상">
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="새 비밀번호 확인">
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
        <button className="btn primary" disabled={!current || !next} onClick={save}>
          변경
        </button>
      </div>
    </Card>
  );
}
