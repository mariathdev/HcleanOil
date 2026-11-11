'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { LogoMark } from '@/components/ui/Logo';
import {
  identificadoresDeCampanha,
  abrirOrcamento,
  enviarLead,
  falhaNoEnvio,
} from '@/lib/analytics';
import {
  LIMITES,
  ORDEM_DOS_CAMPOS,
  ID_DO_CAMPO,
  cursorDepoisDaMascara,
  formatarTelefone,
  idDoErro,
  validar,
  type CampoComErro,
  type Erros,
} from './validacao';
import s from './QuoteModal.module.css';

type Status = 'idle' | 'sending' | 'sent' | 'error';

const ENDPOINT = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type Props = {
  open: boolean;
  onClose: () => void;
  productSlug?: string;
};

export function QuoteModal({ open, onClose, productSlug }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  /* Erros por campo, em português. Substituem `reportValidity()`: o balão
     nativo saía no idioma do navegador e desaparecia ao primeiro clique. */
  const [erros, setErros] = useState<Erros>({});

  /* Abre e fecha o <dialog> nativo em resposta à prop. showModal() é o que
     ativa a camada superior, o backdrop e a prisão de foco. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setStatus('idle');
    setMessage('');
    setErros({});

    /* O pop-up fica montado e só alterna `open`, de modo que o DOM sobrevive
       ao fechamento. Sem limpar aqui, reabrir trazia de volta o que a pessoa
       havia digitado enquanto o pedido zerava — e, pior, o consentimento
       continuava desmarcado numa tela que parecia nova. */
    ref.current?.querySelector('form')?.reset();

    /* Pelo mesmo motivo, o corpo rolável guardava a posição anterior: em tela
       pequena o pop-up reabria no meio do formulário, com Nome e E-mail acima
       da área visível e sem nenhuma pista de que existiam. */
    const corpo = ref.current?.querySelector<HTMLElement>('[data-corpo]');
    if (corpo) corpo.scrollTop = 0;

    abrirOrcamento(productSlug ? 'pagina-de-produto' : 'cta-geral');
  }, [open, productSlug]);

  /* Enquanto o pop-up está aberto, trava o scroll da página atrás. */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  /**
   * Revalida um campo que já estava com erro, conforme a pessoa digita.
   *
   * Só limpa, nunca acusa: marcar um e-mail como inválido enquanto ele está
   * pela metade é acusar o visitante de um erro que ele ainda não cometeu. O
   * erro só nasce no envio ou ao sair do campo.
   */
  function revalidar(campo: CampoComErro) {
    setErros((prev) => {
      if (!prev[campo]) return prev;
      const form = ref.current?.querySelector('form');
      if (!form) return prev;
      const agora = validar(lerCampos(form));
      if (agora[campo]) return prev; // continua inválido: mantém a mensagem
      const { [campo]: _resolvido, ...resto } = prev;
      return resto;
    });
  }

  /** Marca o campo ao sair dele, se estiver inválido. */
  function validarAoSair(campo: CampoComErro) {
    const form = ref.current?.querySelector('form');
    if (!form) return;
    const erro = validar(lerCampos(form))[campo];
    setErros((prev) => {
      if (!erro) {
        if (!prev[campo]) return prev;
        const { [campo]: _resolvido, ...resto } = prev;
        return resto;
      }
      return prev[campo] === erro ? prev : { ...prev, [campo]: erro };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    /* `noValidate` desliga o balão do navegador, que saía no idioma do
       navegador — "Please fill out this field" num formulário em português — e
       sumia ao primeiro clique. A checagem acontece aqui e o erro fica escrito
       ao lado do campo, em português, até ser corrigido. */
    const achados = validar(lerCampos(form));
    if (Object.keys(achados).length) {
      setErros(achados);
      /* Foco no primeiro campo inválido de cima para baixo — não no primeiro
         que a validação encontrou. Em tela pequena o campo pode estar fora da
         área visível, e o `scrollIntoView` é o que o traz junto com o foco. */
      const primeiro = ORDEM_DOS_CAMPOS.find((c) => achados[c]);
      if (primeiro) {
        const el = campoDoForm(form, primeiro);
        el?.focus();
        el?.scrollIntoView({ block: 'center' });
      }
      return;
    }
    setErros({});

    const data = Object.fromEntries(new FormData(form));

    Object.assign(data, identificadoresDeCampanha());

    setStatus('sending');
    setMessage('');

    try {
      const res = await fetch(`${ENDPOINT}/api/contato`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        leadId?: string;
        /* Valor estimado do pedido, calculado pela tabela de preços no
           servidor. O navegador não conhece os preços. */
        valor?: number;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error || 'Não foi possível enviar sua solicitação.');
      }
      enviarLead({
        leadId: body.leadId,
        valor: body.valor,
      });

      setStatus('sent');
      form.reset();
    } catch (err) {
      const motivo = err instanceof Error ? err.message : 'falha desconhecida';
      // Separa abandono de falha técnica: sem isso os dois viram o mesmo buraco
      // no funil.
      falhaNoEnvio(motivo);
      setStatus('error');
      setMessage(
        err instanceof Error ? err.message : 'Não foi possível enviar sua solicitação.',
      );
    }
  }

  return (
    <dialog
      ref={ref}
      className={s.dialog}
      aria-labelledby="quote-title"
      /* Fecha ao clicar fora ou no Esc, mantendo o estado do React em sincronia. */
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {status === 'sent' ? (
        <div className={s.result}>
          <span className={s.resultIcon}>
            <Icon name="check" size={30} strokeWidth={2.4} />
          </span>
          <h2 className={s.resultTitle}>Solicitação enviada</h2>
          <p className={s.resultText}>
            Recebemos seus dados. Nossa equipe comercial entrará em contato para
            orientar você sobre produtos, aplicações e fornecimento.
          </p>
          <div style={{ paddingTop: 8 }}>
            <Button type="button" onClick={onClose}>
              Fechar
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <div className={s.head}>
            <LogoMark size={44} tone="dark" />
            <h2 id="quote-title" className={s.title}>
              Solicitar orçamento
            </h2>
            <p className={s.subtitle}>
              Informe os dados abaixo e nossa equipe retorna com a proposta.
            </p>
            <button
              type="button"
              className={s.close}
              onClick={onClose}
              aria-label="Fechar"
            >
              <Icon name="close" size={20} strokeWidth={2} />
            </button>
          </div>

          <div className={s.body} data-corpo>
            {/* Isca para robôs: humano nunca vê, logo nunca preenche. */}
            <div className={s.hp} aria-hidden="true">
              <label htmlFor="q-empresa-site">Não preencha</label>
              <input id="q-empresa-site" name="empresa_site" tabIndex={-1} autoComplete="off" />
            </div>

            {/* Os ids form-field-Nome / form-field-Email / form-field-phone
                nao seguem o padrao do resto do formulario de proposito: o
                rastreamento de midia le esses campos por seletor CSS, e os
                nomes vem do formulario do site anterior (Elementor).
                Renomear quebra a captura de lead das campanhas. */}
            <div className={s.grid}>
              <div className={s.field}>
                <label className={s.label} htmlFor="form-field-Nome">
                  Nome <span className={s.required}>*</span>
                </label>
                <input
                  className={s.input}
                  id="form-field-Nome"
                  name="nome"
                  required
                  autoComplete="name"
                  maxLength={LIMITES.nome}
                  placeholder="Digite seu nome"
                  aria-invalid={erros.nome ? true : undefined}
                  aria-describedby={erros.nome ? idDoErro('nome') : undefined}
                  onBlur={() => validarAoSair('nome')}
                  onInput={() => revalidar('nome')}
                />
                <Erro campo="nome" texto={erros.nome} />
              </div>

              <div className={s.field}>
                <label className={s.label} htmlFor="q-empresa">
                  Empresa <span className={s.required}>*</span>
                </label>
                <input
                  className={s.input}
                  id="q-empresa"
                  name="empresa"
                  required
                  autoComplete="organization"
                  maxLength={LIMITES.empresa}
                  placeholder="Razão social"
                  aria-invalid={erros.empresa ? true : undefined}
                  aria-describedby={erros.empresa ? idDoErro('empresa') : undefined}
                  onBlur={() => validarAoSair('empresa')}
                  onInput={() => revalidar('empresa')}
                />
                <Erro campo="empresa" texto={erros.empresa} />
              </div>

              <div className={s.field}>
                <label className={s.label} htmlFor="form-field-Email">
                  E-mail <span className={s.required}>*</span>
                </label>
                <input
                  className={s.input}
                  id="form-field-Email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  maxLength={LIMITES.email}
                  placeholder="Digite um e-mail válido"
                  aria-invalid={erros.email ? true : undefined}
                  aria-describedby={erros.email ? idDoErro('email') : undefined}
                  onBlur={() => validarAoSair('email')}
                  onInput={() => revalidar('email')}
                />
                <Erro campo="email" texto={erros.email} />
              </div>

              <div className={s.field}>
                <label className={s.label} htmlFor="form-field-phone">
                  DDD + Telefone
                </label>
                {/* Sem `maxLength` aqui, de propósito — e isto é o oposto do
                    que parece certo.

                    `maxLength` conta caracteres JÁ formatados (15, de
                    "(21) 99999-9999"), mas o texto colado chega cru e mais
                    longo: "+55 (21) 99999-8888" tem 19. O navegador corta em
                    15 ANTES de qualquer handler rodar, então a máscara recebia
                    "+55 (21) 99999-" — nove dígitos, com o código do país já
                    impossível de distinguir do DDD — e produzia
                    "(55) 2199-999", que o servidor recusa. Medido: com o
                    atributo, "(55) 2199-999"; sem ele, "(21) 99999-8888".

                    Quem garante o limite é a máscara, que corta em 11 dígitos
                    na origem e nunca escreve mais de 15 caracteres no campo.
                    O atributo seria redundante no melhor caso e destrutivo no
                    pior. `LIMITES.telefone` continua sendo o teto que a
                    máscara respeita. */}
                <input
                  className={s.input}
                  id="form-field-phone"
                  name="telefone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="(21) 99999-9999"
                  aria-invalid={erros.telefone ? true : undefined}
                  aria-describedby={erros.telefone ? idDoErro('telefone') : undefined}
                  onBlur={() => validarAoSair('telefone')}
                  onInput={(e) => {
                    const alvo = e.currentTarget;
                    const anterior = alvo.value;
                    const cursor = alvo.selectionStart ?? anterior.length;
                    const formatado = formatarTelefone(anterior);
                    if (formatado !== anterior) {
                      alvo.value = formatado;
                      /* Reposicionar o cursor é obrigatório aqui: reescrever
                         `value` joga o cursor para o fim do campo, e corrigir
                         um dígito no meio de um número já preenchido ficava
                         impossível — o dígito seguinte ia para o final. */
                      const destino = cursorDepoisDaMascara(formatado, anterior, cursor);
                      alvo.setSelectionRange(destino, destino);
                    }
                    revalidar('telefone');
                  }}
                />
                <Erro campo="telefone" texto={erros.telefone} />
              </div>

              <div className={s.field}>
                <label className={s.label} htmlFor="q-mensagem">
                  O que você precisa?
                </label>
                <textarea
                  className={s.textarea}
                  id="q-mensagem"
                  name="mensagem"
                  rows={4}
                  maxLength={LIMITES.mensagem}
                  placeholder="Descreva o produto, a aplicação ou o cenário da operação."
                />
              </div>

              {status === 'error' ? (
                <div className={s.alert} role="alert">
                  <Icon name="alert" size={17} />
                  <span>{message}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className={s.footer}>
            <label className={s.consent}>
              <input type="checkbox" name="consentimento" defaultChecked />
              Aceito receber contato e comunicações técnicas por e-mail.
            </label>
            <Button
              type="submit"
              size="lg"
              fullWidth
              iconRight="arrow-right"
              disabled={status === 'sending'}
            >
              {status === 'sending' ? 'Enviando…' : 'Enviar mensagem'}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/* ------------------------------------------------------------------ campos */

/**
 * Lê os campos validados direto do DOM.
 *
 * O formulário é não-controlado de propósito — é o que deixa o autofill do
 * navegador funcionar e o que faz `form.reset()` limpar tudo de uma vez. Então
 * a validação lê os valores na hora, em vez de manter uma cópia em estado que
 * o autofill não atualizaria.
 */
function lerCampos(form: HTMLFormElement): Record<CampoComErro, string> {
  /* Busca por `id` e não por `name`: `elements.namedItem` devolve uma
     RadioNodeList quando há mais de um campo com o mesmo nome, e os nomes das
     quantidades são montados a partir do produto escolhido — um deles pode
     colidir. O `id` é único por definição. */
  const ler = (campo: CampoComErro) => {
    const el = form.querySelector<HTMLInputElement | HTMLSelectElement>(
      `#${ID_DO_CAMPO[campo]}`,
    );
    return el ? el.value : '';
  };
  return {
    nome: ler('nome'),
    empresa: ler('empresa'),
    email: ler('email'),
    telefone: ler('telefone'),
  };
}

/** Elementos dos campos validados, na ordem do formulário. */
function campoDoForm(form: HTMLFormElement, campo: CampoComErro) {
  return form.querySelector<HTMLElement>(`#${ID_DO_CAMPO[campo]}`);
}

/**
 * Mensagem de erro de um campo.
 *
 * `role="alert"` para o leitor de tela anunciar o erro quando ele aparece; o
 * `id` é o mesmo que o campo referencia em `aria-describedby`.
 */
function Erro({ campo, texto }: { campo: CampoComErro; texto?: string }) {
  if (!texto) return null;
  return (
    <p className={s.error} id={idDoErro(campo)} role="alert">
      {texto}
    </p>
  );
}

