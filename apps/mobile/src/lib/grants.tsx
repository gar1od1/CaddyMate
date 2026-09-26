/**
 * The signed-in user's grants as React context (docs/standards/permissions.md
 * §5 gate 3). The root layout loads them (its `useGrants(userId)`) and
 * provides them with `<GrantsProvider value={grants}>`; screens read them to
 * hide tiles and links for pages the role can't open. Without a provider the
 * player defaults apply — the same fail-safe the layout starts from.
 */
import { grantsForRole, type Grants } from '@caddymate/api';
import { createContext, useContext } from 'react';

const GrantsContext = createContext<Grants>(grantsForRole('player'));

export const GrantsProvider = GrantsContext.Provider;

/** The grants in force for this screen (player defaults until the layout provides them). */
export const useGrants = () => useContext(GrantsContext);
