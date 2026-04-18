# -*- coding: utf-8 -*-
"""
Casos de uso de la aplicacion Carlitos.
Orquesta el flujo entre dominio e infraestructura.
"""
import os
from typing import AsyncGenerator

from ..domain.entities import (
    Mensaje, TipoMensaje, ResultadoCarpeta, TipoDocumento,
    RespuestaStream, EstadoRostro, SolicitudAnalisis
)
from ..domain.interfaces import (
    IRepositorioPDF, IGeneradorDocumentos, IClienteLLM, IServicioCenso
)

RUTA_CNE    = os.environ.get("CNE_DOWNLOAD_DIR", r"C:\CNE_Descargas")
RUTA_SALIDA = os.environ.get("CNE_OUTPUT_DIR",   os.path.join(RUTA_CNE, "Liquidaciones_Generadas"))


class CasoUsoChat:
    """Maneja la conversacion con el LLM sobre documentos CNE."""

    def __init__(
        self,
        cliente_llm: IClienteLLM,
        repo_pdf: IRepositorioPDF,
        generador: IGeneradorDocumentos,
        servicio_censo: IServicioCenso,
    ):
        self._llm = cliente_llm
        self._pdf = repo_pdf
        self._doc = generador
        self._censo = servicio_censo

    async def responder(
        self,
        historial: list[Mensaje],
        carpeta_activa: str | None = None,
    ) -> AsyncGenerator[RespuestaStream, None]:
        """
        Genera respuesta en streaming.
        Si hay carpeta activa, incluye su contexto en el prompt.
        """
        contexto = None
        if carpeta_activa:
            try:
                contexto = self._pdf.parsear_carpeta(carpeta_activa)
            except Exception as e:
                yield RespuestaStream(
                    texto=f"No pude leer la carpeta: {e}",
                    es_final=True,
                    estado_rostro=EstadoRostro.ERROR,
                )
                return

        herramientas = self._construir_herramientas()

        async for chunk in self._llm.analizar_y_responder(historial, contexto, herramientas):
            yield chunk

    def _construir_herramientas(self) -> list:
        return [
            {
                "name": "procesar_carpeta_cne",
                "description": (
                    "Procesa una carpeta de CNE_Descargas: parsea los PDFs, "
                    "calcula la liquidacion y genera el documento Word (Certificado o Requerimiento). "
                    "Usa esta herramienta cuando el usuario pida analizar, procesar o generar documentos "
                    "para una carpeta especifica."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "nombre_carpeta": {
                            "type": "string",
                            "description": "Nombre de la carpeta en C:\\CNE_Descargas, p.ej. 'ALCALDIA_Caldas_Manizales_PARTIDO COLOMBIA RENACIENTE'"
                        },
                        "generar_documento": {
                            "type": "boolean",
                            "description": "Si True, genera el Word correspondiente",
                            "default": True
                        },
                        "nombre_contador": {
                            "type": "string",
                            "description": "Nombre completo del Contador Público asignado a revisar este informe (p.ej. 'EDISON GOMEZ RUNZA')"
                        },
                        "tp_contador": {
                            "type": "string",
                            "description": "Número de Tarjeta Profesional del Contador Público (p.ej. '335409-T')"
                        },
                        "observaciones_texto": {
                            "type": "string",
                            "description": "Texto completo de las observaciones para el oficio de requerimiento. Solo se usa cuando el resultado es Requerimiento (no Certificado). Incluir observaciones específicas por formulario y código."
                        }
                    },
                    "required": ["nombre_carpeta", "nombre_contador", "tp_contador"]
                }
            },
            {
                "name": "analizar_carpeta_cne",
                "description": (
                    "PRIMER PASO: Analiza una carpeta CNE y retorna todos los datos detallados "
                    "(candidatos, gastos por código, detalle de comprobantes, inconsistencias). "
                    "Usa esta herramienta ANTES de generar el oficio de requerimiento para "
                    "poder formular observaciones específicas basadas en los datos reales."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "nombre_carpeta": {
                            "type": "string",
                            "description": "Nombre de la carpeta en C:\\CNE_Descargas"
                        }
                    },
                    "required": ["nombre_carpeta"]
                }
            },
            {
                "name": "listar_carpetas",
                "description": "Lista todas las carpetas disponibles en C:\\CNE_Descargas para procesar.",
                "input_schema": {
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            },
            {
                "name": "consultar_normatividad",
                "description": (
                    "Consulta resúmenes rápidos de normatividad (topes, votos, plazos, sanciones). "
                    "Usa cuando necesites un dato específico y conocido de la norma."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "tema": {
                            "type": "string",
                            "description": "Tema a consultar: 'topes', 'votos', 'plazos', 'sanciones', 'general'"
                        }
                    },
                    "required": ["tema"]
                }
            },
            {
                "name": "buscar_normatividad",
                "description": (
                    "Busca en los PDFs oficiales de normatividad electoral (resoluciones CNE, leyes, decretos) "
                    "los fragmentos más relevantes para responder una pregunta. "
                    "Usa esta herramienta cuando el usuario pregunte sobre artículos específicos, "
                    "requisitos legales, plazos, montos, sanciones u otras disposiciones normativas. "
                    "Devuelve texto real de los documentos oficiales."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "consulta": {
                            "type": "string",
                            "description": "Pregunta o tema a buscar en la normatividad, en lenguaje natural. "
                                           "Ej: 'tope máximo de gastos alcaldía 2023', "
                                           "'plazo para presentar informe candidatos', "
                                           "'valor reposición por voto concejos'"
                        }
                    },
                    "required": ["consulta"]
                }
            },
            {
                "name": "generar_liquidacion",
                "description": (
                    "Genera el documento Word de liquidación MI-RR-FO02 para UNA carpeta CNE. "
                    "Calcula votos, gastos, topes, valor a reponer y descuento del 1%. "
                    "Usa esta herramienta cuando el usuario pida crear o generar la liquidación de una carpeta específica."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "nombre_carpeta": {
                            "type": "string",
                            "description": "Nombre de la carpeta en C:\\CNE_Descargas"
                        },
                        "nombre_contador": {
                            "type": "string",
                            "description": "Nombre completo del Contador Público"
                        },
                        "tp_contador": {
                            "type": "string",
                            "description": "Número de Tarjeta Profesional del Contador"
                        }
                    },
                    "required": ["nombre_carpeta", "nombre_contador", "tp_contador"]
                }
            },
            {
                "name": "generar_todas_liquidaciones",
                "description": (
                    "Genera automáticamente los documentos Word de liquidación MI-RR-FO02 "
                    "para TODAS las carpetas disponibles en C:\\CNE_Descargas. "
                    "Usa esta herramienta cuando el usuario pida generar todas las liquidaciones, "
                    "procesar todo en lote, o generar liquidaciones de forma automática. "
                    "Retorna un resumen con el total generado, valor a pagar por carpeta y errores."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "nombre_contador": {
                            "type": "string",
                            "description": "Nombre completo del Contador Público que firma las liquidaciones"
                        },
                        "tp_contador": {
                            "type": "string",
                            "description": "Número de Tarjeta Profesional del Contador"
                        },
                        "solo_pendientes": {
                            "type": "boolean",
                            "description": "Si True, omite las carpetas que ya tienen liquidación generada. Por defecto False.",
                            "default": False
                        }
                    },
                    "required": ["nombre_contador", "tp_contador"]
                }
            },
            {
                "name": "leer_documento",
                "description": (
                    "Lee el contenido de un documento Word (.docx) o PDF (.pdf) dado su ruta completa. "
                    "Usa esta herramienta cuando el usuario pida analizar, revisar ortografía, "
                    "verificar redacción o validar el contenido normativo de un archivo específico. "
                    "Después de leer el documento, analiza su contenido y usa buscar_normatividad "
                    "para verificar que las resoluciones, artículos y disposiciones citadas sean correctas."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "ruta": {
                            "type": "string",
                            "description": "Ruta completa del archivo a leer. "
                                           "Ej: 'C:\\\\CNE_Descargas\\\\Liquidaciones_Generadas\\\\Certificado.docx'"
                        }
                    },
                    "required": ["ruta"]
                }
            }
        ]


class CasoUsoProcesarCarpeta:
    """Procesa una carpeta CNE completa y genera documentos."""

    def __init__(
        self,
        repo_pdf: IRepositorioPDF,
        generador: IGeneradorDocumentos,
        servicio_censo: IServicioCenso,
    ):
        self._pdf = repo_pdf
        self._doc = generador
        self._censo = servicio_censo

    def ejecutar(self, nombre_carpeta: str, generar_doc: bool = True, nombre_contador: str = "", tp_contador: str = "", observaciones_texto: str = "") -> ResultadoCarpeta:
        """Procesa una carpeta y retorna resultado."""
        import sys
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

        from datos_soporte import calcular_liquidacion, obtener_tope_y_censo

        ruta = os.path.join(RUTA_CNE, nombre_carpeta)
        if not os.path.isdir(ruta):
            return ResultadoCarpeta(
                nombre=nombre_carpeta,
                entidad="", departamento="", municipio="", partido="",
                error=f"Carpeta no encontrada: {ruta}"
            )

        # 1. Parsear PDFs
        datos = self._pdf.parsear_carpeta(ruta)

        # 2. Obtener topes y censo
        info = obtener_tope_y_censo(
            datos.municipio, datos.departamento, datos.entidad
        )
        datos.censo_electoral = info["potencial"]
        datos.tope_gastos = info["tope_gastos"]

        # 3. Calcular liquidacion
        liquidacion = calcular_liquidacion(datos)

        # 4. Determinar tipo documento
        cumple = self._verificar_normatividad(datos, liquidacion)
        tipo = TipoDocumento.CERTIFICADO if cumple else TipoDocumento.OFICIO_REQUERIMIENTO

        # 5. Generar documento
        ruta_doc = ""
        if generar_doc:
            os.makedirs(RUTA_SALIDA, exist_ok=True)
            ruta_doc = os.path.join(RUTA_SALIDA, f"{nombre_carpeta}_{tipo.value}.docx")
            if tipo == TipoDocumento.CERTIFICADO:
                self._doc.generar_certificado(datos, liquidacion, ruta_doc, nombre_contador, tp_contador)
            else:
                self._doc.generar_oficio(datos, liquidacion, ruta_doc, observaciones_texto)

        return ResultadoCarpeta(
            nombre=nombre_carpeta,
            entidad=datos.entidad,
            departamento=datos.departamento,
            municipio=datos.municipio,
            partido=datos.partido,
            total_ingresos=datos.total_ingresos,
            total_gastos=datos.total_gastos,
            tope_gastos=datos.tope_gastos,
            censo_electoral=datos.censo_electoral,
            votos_validos=liquidacion.get("total_votos_validos", 0),
            total_neto=liquidacion.get("total_neto_reponer", 0),
            tipo_documento=tipo,
            ruta_documento=ruta_doc,
            cumple_normatividad=cumple,
        )

    def _verificar_normatividad(self, datos, liquidacion: dict) -> bool:
        """Verifica si cumple con normatividad. Retorna True si debe emitirse Certificado."""
        if datos.total_gastos > datos.tope_gastos:
            return False
        if datos.total_ingresos < datos.total_gastos:
            return False
        if len(datos.candidatos_no_rindieron) > 0:
            return False
        return True


class CasoUsoListarCarpetas:
    """Lista carpetas disponibles en CNE_Descargas."""

    def __init__(self, repo_pdf: IRepositorioPDF):
        self._pdf = repo_pdf

    def ejecutar(self) -> list[str]:
        return self._pdf.listar_carpetas(RUTA_CNE)


class CasoUsoAnalizarCarpeta:
    """Analiza una carpeta CNE y retorna datos detallados para que Carlitos formule observaciones."""

    def __init__(self, repo_pdf: IRepositorioPDF, servicio_censo: IServicioCenso):
        self._pdf = repo_pdf
        self._censo = servicio_censo

    def ejecutar(self, nombre_carpeta: str) -> dict:
        import sys
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        from datos_soporte import calcular_liquidacion, obtener_tope_y_censo

        ruta = os.path.join(RUTA_CNE, nombre_carpeta)
        if not os.path.isdir(ruta):
            return {"error": f"Carpeta no encontrada: {ruta}"}

        datos = self._pdf.parsear_carpeta(ruta)
        info = obtener_tope_y_censo(datos.municipio, datos.departamento, datos.entidad)
        datos.censo_electoral = info["potencial"]
        datos.tope_gastos = info["tope_gastos"]
        liquidacion = calcular_liquidacion(datos)

        # Detectar inconsistencias básicas
        inconsistencias = []
        if datos.total_gastos > datos.tope_gastos:
            inconsistencias.append(f"Gastos totales (${datos.total_gastos:,.0f}) superan el tope (${datos.tope_gastos:,.0f})")
        if datos.total_gastos > datos.total_ingresos:
            inconsistencias.append(f"Gastos (${datos.total_gastos:,.0f}) superan ingresos (${datos.total_ingresos:,.0f})")
        if datos.candidatos_no_rindieron:
            nombres = [c.nombre for c in datos.candidatos_no_rindieron]
            inconsistencias.append(f"Candidatos que NO rindieron informe: {', '.join(nombres)}")

        return {
            "entidad": datos.entidad,
            "municipio": datos.municipio,
            "departamento": datos.departamento,
            "partido": datos.partido,
            "num_radicacion": datos.num_radicacion,
            "representante_legal": datos.representante_legal,
            "auditor_interno": datos.auditor_interno,
            "tp_auditor": datos.tp_auditor,
            "total_ingresos": datos.total_ingresos,
            "total_gastos": datos.total_gastos,
            "tope_gastos": datos.tope_gastos,
            "censo_electoral": datos.censo_electoral,
            "votos_validos": liquidacion.get("total_votos_validos", 0),
            "gastos_por_codigo": datos.gastos_codigos,
            "ingresos_por_codigo": datos.ingresos,
            "detalle_gastos": [
                {
                    "codigo": g.codigo,
                    "concepto": g.concepto,
                    "beneficiario": g.beneficiario,
                    "cedula_beneficiario": g.cedula_beneficiario,
                    "valor": g.valor,
                }
                for g in datos.detalle_gastos
            ],
            "candidatos": [
                {
                    "nombre": c.nombre,
                    "cedula": c.cedula,
                    "ingresos": c.ingresos,
                    "gastos": c.gastos,
                    "votos": c.votos,
                    "presento": c.presento,
                    "presento_debida_forma": c.presento_debida_forma,
                }
                for c in datos.candidatos
            ],
            "candidatos_no_rindieron": [
                {"nombre": c.nombre, "cedula": c.cedula, "votos": c.votos}
                for c in datos.candidatos_no_rindieron
            ],
            "candidatos_revocados": [
                {"nombre": c.nombre, "cedula": c.cedula}
                for c in datos.candidatos_revocados
            ],
            "cumple_normatividad": len(inconsistencias) == 0 and not datos.candidatos_no_rindieron,
            "tipo_documento_sugerido": "Certificado" if (len(inconsistencias) == 0 and not datos.candidatos_no_rindieron) else "Requerimiento",
            "inconsistencias_detectadas": inconsistencias,
        }
