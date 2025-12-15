# IRRL — Manifiesto para la Infraestructura de Confianza

**Autor:** Oscar Fuentes Fernández  
**Versión:** 2.0  
**Fecha:** Diciembre 2025

---

## Prólogo

La civilización digital no colapsa por falta de información,  
sino por falta de **criterios verificables de confianza**.

Cada segundo, millones de decisiones dependen de la pregunta:  
*"¿Puedo confiar en esto?"*

Y cada segundo, esa pregunta se responde con:
- Estrellas sin contexto
- Likes sin evidencia
- Scores sin explicación
- Votos sin verificación

IRRL existe porque la confianza merece **infraestructura**.

---

## El Problema

### La Crisis de Confianza Digital

En 2025, vivimos una paradoja: tenemos más información que nunca, pero menos capacidad de confiar en ella.

**Los sistemas actuales fallan porque:**

1. **Confunden señales con sustancia**
   - 10,000 seguidores ≠ experto
   - 5 estrellas ≠ calidad verificada
   - Verificado ✓ ≠ confiable

2. **No exigen evidencia**
   - Cualquiera puede afirmar cualquier cosa
   - Las reseñas pueden ser compradas
   - Los testimonios pueden ser fabricados

3. **Ignoran el contexto**
   - Un médico excelente puede ser pésimo inversionista
   - Un desarrollador senior puede ser novato en machine learning
   - La reputación no es transferible entre dominios

4. **No permiten auditoría**
   - ¿Por qué este vendedor tiene 4.8 estrellas?
   - ¿Quién verificó estas credenciales?
   - ¿Cuándo se hizo la última validación?

5. **Son vulnerables a manipulación**
   - Ataques Sybil (cuentas falsas)
   - Colusión entre actores
   - Farming de reputación

### La Era de los Agentes Autónomos

El problema se amplifica exponencialmente con la llegada de agentes de IA autónomos:

- ¿Cómo sabe un sistema si puede delegar una tarea a un agente?
- ¿Cómo verificamos que un agente ha cumplido consistentemente?
- ¿Cómo construimos confianza entre agentes que nunca se han "conocido"?

Los humanos podemos usar intuición, contexto social, lenguaje corporal.  
Las máquinas necesitan **datos verificables**.

---

## La Solución: IRRL

IRRL no es una aplicación. Es **infraestructura**.

Como TCP/IP no dice qué mensajes enviar, sino cómo enviarlos,  
IRRL no dice en quién confiar, sino **cómo verificar la confianza**.

### Principios Fundacionales

#### 1. La Confianza es Contextual
```
confianza(X, Y) ≠ confianza(X, Z)
```
Un desarrollador excelente en Python puede ser novato en Rust.  
Un analista preciso en crypto puede fallar en bienes raíces.  
La reputación debe estar **ligada a dominios específicos**.

#### 2. Toda Reputación Debe Ser Explicable
```
score: 87/100
↓
¿Por qué?
↓
- 23 attestations verificadas
- 15 evaluadores distintos
- Consistencia temporal de 94%
- Sin alertas de Sybil
```

#### 3. Toda Afirmación Requiere Evidencia Verificable
```
Afirmación: "Alice completó 50 tareas de código"
Evidencia: { taskIds: [...], verificationEndpoint: "..." }
Resolver: task-completion-resolver@2.0
Verificación: reproducible, auditable
```

#### 4. Ninguna Autoridad Central Decide
Los **Realms** definen sus propias reglas.  
IRRL proporciona infraestructura, no juicio.

#### 5. La Reputación es Portable, Auditable y Revocable
- **Portable**: Pruebas criptográficas que funcionan en cualquier sistema
- **Auditable**: Cada cálculo es reproducible
- **Revocable**: Las attestations pueden expirar o invalidarse

#### 6. Resistencia a Manipulación
- La verificación mediante resolvers hace costoso fabricar evidencia
- El análisis de grafos detecta patrones de colusión
- La diversidad temporal dificulta el farming

---

## Arquitectura Conceptual

```
                    ┌─────────────────────────────┐
                    │     PRUEBAS PORTABLES       │
                    │  (Consumidas por terceros)  │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │        REPUTACIÓN           │
                    │  Contextual + Transitive    │
                    │  con Decay Temporal         │
                    └──────────────┬──────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
┌───────▼───────┐         ┌────────▼────────┐        ┌────────▼────────┐
│  EVALUACIONES │         │  ATTESTATIONS   │        │    RESOLVERS    │
│  (Trust Edges)│         │ (Claims+Evidence)│        │ (Verificadores) │
└───────────────┘         └─────────────────┘        └─────────────────┘
        │                          │                          │
        └──────────────────────────┼──────────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │          REALMS             │
                    │  (Contextos de Confianza)   │
                    │     con Herencia            │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │        AUDIT LOG            │
                    │  (Cadena Criptográfica)     │
                    └─────────────────────────────┘
```

---

## Casos de Uso

### 1. Selección de Agentes de IA
```typescript
// ¿Qué agente debería usar para esta tarea de código?
const agents = await irrl.findTrusted({
  realm: "ai/agents/coding",
  domain: "python-backend",
  minScore: 75,
  requiredVerifications: ["task-completion", "code-quality"]
});

// Resultado: Lista ordenada de agentes con explicación de por qué son confiables
```

### 2. Verificación de Expertos
```typescript
// ¿Este "experto en blockchain" realmente lo es?
const reputation = await irrl.getReputation({
  subject: "expert-123",
  realm: "technology/blockchain",
  domain: "smart-contracts"
});

// Resultado: Score + evidencia de contributions verificados
```

### 3. Confianza Transitiva
```typescript
// Mi empresa confía en Acme Corp. ¿Deberíamos confiar en su proveedor XYZ?
const trust = await irrl.computeTransitiveTrust({
  from: "my-company",
  to: "xyz-supplier",
  domain: "manufacturing-quality",
  maxDepth: 3
});

// Resultado: Score con path de confianza y decay aplicado
```

### 4. Auditoría de Decisiones
```typescript
// ¿Por qué el sistema eligió este proveedor?
const audit = await irrl.getAuditTrail({
  decision: "selected-supplier-abc",
  includeEvidence: true
});

// Resultado: Cadena completa de attestations, verificaciones, y cálculos
```

---

## Comparación con Alternativas

| Aspecto | IRRL | EAS (Ethereum) | Verifiable Credentials | Sistemas Tradicionales |
|---------|------|----------------|----------------------|------------------------|
| Contextualidad | ✅ Realms jerárquicos | ❌ Schemas planos | ⚠️ Limited | ❌ Global |
| Confianza Transitiva | ✅ Computable | ❌ No | ❌ No | ❌ No |
| Decay Temporal | ✅ Configurable | ❌ No | ❌ No | ❌ No |
| Anti-Sybil | ✅ Multi-factor | ⚠️ Gas cost | ⚠️ Issuer trust | ❌ Vulnerable |
| Verificación | ✅ Resolvers modulares | ⚠️ Manual | ⚠️ Issuer-dependent | ❌ None |
| Infraestructura | PostgreSQL + API | Blockchain | Varies | Proprietary |
| Costo | ~$0 | Gas fees | Varies | Varies |
| Tiempo de Deploy | Minutos | Horas | Horas | Weeks |

---

## Compromisos

### Para Usuarios
- Soberanía sobre sus datos
- Transparencia en cómo se calcula su reputación
- Portabilidad de sus pruebas de confianza

### Para Verificadores
- Trazabilidad completa
- Reproducibilidad de verificaciones
- Explicabilidad de scores

### Para Desarrolladores
- API simple y consistente
- Extensibilidad mediante resolvers
- Documentación completa

### Para la Comunidad
- Código abierto (MIT)
- Neutralidad de la infraestructura
- Gobernanza transparente

---

## Llamada a la Acción

La infraestructura de confianza no se construye en aislamiento.  
Se construye en **uso**.

### Si construyes sistemas que evalúan confianza:
1. Considera integrar IRRL como tu capa de reputación
2. Contribuye resolvers para tu dominio
3. Comparte feedback sobre lo que falta

### Si investigas sistemas de confianza:
1. Examina nuestras primitivas
2. Propón mejoras al modelo
3. Ayuda a formalizar la teoría

### Si simplemente te importa la confianza digital:
1. Usa productos que implementen IRRL
2. Exige explicabilidad en los sistemas que usas
3. Difunde la idea de que la confianza requiere infraestructura

---

## Epílogo

> "La nueva era no empieza cuando muchos creen.  
> Empieza cuando alguien deja la herramienta sobre la mesa."

IRRL es esa herramienta.

No pretende resolver todos los problemas de confianza.  
Pretende hacer posible que **cualquiera** pueda construir soluciones verificables.

La pregunta "¿por qué debería confiar?" merece una respuesta mejor que "porque sí".

IRRL hace posible responder: **"Por esto. Verificable. Auditable. Explicable."**

---

*IRRL v2.0 — Diciembre 2025*  
*Oscar Fuentes Fernández*
