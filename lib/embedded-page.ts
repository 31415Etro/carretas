"use client"

import { createContext } from "react"

/** Dentro de uma aba de outra página: o PageShell não repete o menu lateral nem o banner. */
export const EmbeddedPageContext = createContext(false)
