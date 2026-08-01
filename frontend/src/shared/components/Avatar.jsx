import React from 'react'

// Avatar com iniciais — usado onde não existe foto real (nem passageiro nem motorista
// têm campo de foto de perfil hoje, exceto user.profilePicture). Antes essas telas
// mostravam a foto de uma pessoa real e desconhecida (Pinterest/Google Images) como se
// fosse o usuário da corrida.
const Avatar = ({ firstname, lastname, size = 'h-12 w-12', className = '' }) => {
    const initials = `${firstname?.[0] || ''}${lastname?.[0] || ''}`.toUpperCase() || '?'

    return (
        <div className={`${size} rounded-full bg-green-500 text-white flex items-center justify-center font-bold flex-shrink-0 ${className}`}>
            <span style={{ fontSize: '0.9em' }}>{initials}</span>
        </div>
    )
}

export default Avatar
