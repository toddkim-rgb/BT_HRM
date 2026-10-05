import { useState } from 'react';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Select, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PARTNER_STATUS } from '../lib/codes';
import { label } from '../lib/format';
import { useFetch } from '../lib/hooks';

interface Partner {
  partnerId: string;
  partnerNm: string;
  bizRegNo: string | null;
  contactNm: string | null;
  contactPhone: string | null;
  contractStartDt: string | null;
  contractEndDt: string | null;
  statusCd: string;
  headcount?: number;
}

export default function Partners() {
  const { can } = useAuth();
  const isAdmin = can('partners', 'EDIT');
  const { data, error, loading, reload } = useFetch<Partner[]>('/admin/partners');
  const [edit, setEdit] = useState<Partial<Partner> | null>(null);

  return (
    <div>
      <PageHeader
        title="협력사"
        desc="협력사 마스터. 협력사·프리랜서 인력은 반드시 협력사에 연결됩니다. (인력별 계약·단가는 손익 단계에서 추가)"
        actions={
          isAdmin && (
            <button className="btn primary" onClick={() => setEdit({ statusCd: 'ACTIVE' })}>
              + 협력사 등록
            </button>
          )
        }
      />
      <Card>
        <ErrorBox error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.length ? (
          <Empty />
        ) : (
          <div className="table-wrap">
            <table className="tbl responsive">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>협력사명</th>
                  <th>사업자등록번호</th>
                  <th>담당자</th>
                  <th>기본 계약기간</th>
                  <th className="num">투입 인원</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.partnerId} className={isAdmin ? 'clickable' : ''} onClick={() => isAdmin && setEdit(p)}>
                    <td data-label="ID">{p.partnerId}</td>
                    <td data-label="협력사명">
                      <strong>{p.partnerNm}</strong>
                    </td>
                    <td data-label="사업자등록번호">{p.bizRegNo ?? '-'}</td>
                    <td data-label="담당자">{[p.contactNm, p.contactPhone].filter(Boolean).join(' · ') || '-'}</td>
                    <td data-label="기본 계약기간" className="nowrap">
                      {p.contractStartDt ?? ''} ~ {p.contractEndDt ?? ''}
                    </td>
                    <td data-label="투입 인원" className="num">
                      {p.headcount}명
                    </td>
                    <td data-label="상태">
                      <Badge code={p.statusCd}>{label(PARTNER_STATUS, p.statusCd)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {edit && (
        <PartnerForm
          initial={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function PartnerForm({ initial, onClose, onSaved }: { initial: Partial<Partner>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<Partner>) => setF((s) => ({ ...s, ...p }));
  const isNew = !initial.partnerId;

  const save = async () => {
    try {
      if (isNew) await api.post('/admin/partners', f);
      else await api.put(`/admin/partners/${initial.partnerId}`, f);
      toast('저장했습니다.');
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const remove = async () => {
    if (!window.confirm('삭제할까요?')) return;
    try {
      await api.del(`/admin/partners/${initial.partnerId}`);
      toast('삭제했습니다.');
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal
      title={isNew ? '협력사 등록' : `협력사 수정 · ${initial.partnerId}`}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button className="btn danger" onClick={remove} style={{ marginRight: 'auto' }}>
              삭제
            </button>
          )}
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" onClick={save}>
            저장
          </button>
        </>
      }
    >
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="협력사명" required full>
          <input value={f.partnerNm ?? ''} onChange={(e) => set({ partnerNm: e.target.value })} />
        </Field>
        <Field label="사업자등록번호">
          <input value={f.bizRegNo ?? ''} onChange={(e) => set({ bizRegNo: e.target.value })} />
        </Field>
        <Field label="상태">
          <Select value={f.statusCd} onChange={(statusCd) => set({ statusCd })} options={PARTNER_STATUS} />
        </Field>
        <Field label="담당자">
          <input value={f.contactNm ?? ''} onChange={(e) => set({ contactNm: e.target.value })} />
        </Field>
        <Field label="연락처">
          <input value={f.contactPhone ?? ''} onChange={(e) => set({ contactPhone: e.target.value })} />
        </Field>
        <Field label="기본계약 시작">
          <input type="date" value={f.contractStartDt ?? ''} onChange={(e) => set({ contractStartDt: e.target.value })} />
        </Field>
        <Field label="기본계약 종료">
          <input type="date" value={f.contractEndDt ?? ''} onChange={(e) => set({ contractEndDt: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
