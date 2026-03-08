# Dashboard de Notas EscolaRS

Chrome Extension para gerenciar notas de alunos da API EscolaRS com dashboard, filtros dinâmicos e exportação em XLSX.

## Funcionalidades

- Dashboard com visualização de turmas, disciplinas e alunos
- Filtros por escola, turma e nome de aluno
- Cálculo automático de médias (trimestral e semestral)
- Suporte a notas de recuperação (ER)
- Gestão de alunos inativos (visual diferenciado, não afetam cálculos)
- Estatísticas em tempo real
- Exportação em XLSX com múltiplas abas
- Formatação brasileira (1 casa decimal com ",")

## Instalação

1. Clone o repositório
2. Digite `chrome://extensions` no navegador
3. Ative "Modo do desenvolvedor"
4. Clique em "Carregar extensão não empacotada"
5. Selecione a pasta `escolaRS-extensao`
6. Autentique-se no portal EscolaRS

## Como Usar

Filtros:
- **Escola**: Selecione uma escola ou visualize todas
- **Turma**: Filtre por turma (respeitando escola selecionada)
- **Buscar Aluno**: Digite o nome para filtrar em tempo real

Exportação:
- Aplique os filtros desejados
- Clique em "Exportar XLSX"
- Arquivo gerado com uma aba por turma

## Estrutura

```
escolaRS-extensao/
├── manifest.json       # Configuração da extensão
├── background.js       # Service worker (autenticação e API)
├── dashboard.html      # Interface principal
├── dashboard.js        # Lógica e filtros
├── xlsx.mini.min.js    # Biblioteca XLSX
└── icons/             # Ícones
```

## Fórmulas de Cálculo

**Trimestral:** Média = (T1×3 + T2×3 + T3×4) ÷ 10
**Semestral (EJA):** Média = (S1 + S2) ÷ 2

## Status de Alunos

- Aprovado: Média ≥ 6,0
- Recuperação: Média 5,0 a 5,9
- Reprovado: Média < 5,0
- Inativos: Aparecem em cinza sem valores numéricos

## Tecnologias

- Manifest V3
- Service Worker
- Vanilla JavaScript (sem frameworks)
- HTML5 + CSS3
- XLSX.js

## Notas Importantes

- Requer autenticação prévia no EscolaRS
- Notas normalizadas para 1 casa decimal
- Cálculos consideram apenas alunos ativos
- Dados atualizados sob demanda

## Autor

Eduardo L. Borges
